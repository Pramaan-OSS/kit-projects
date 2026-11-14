// The one server-side client for platform email and private file storage.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import type { Mailer } from "./email";

const dir = () => process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";
export const emailDoor: Mailer = {
  send(message, key) {
    return new Promise((resolve) => {
      let token: string;
      try {
        token = readFileSync(path.join(dir(), "token"), "utf8").trim();
      } catch {
        resolve({ status: "not-sent" });
        return;
      }
      const body = JSON.stringify(message);
      const sent = request(
        {
          socketPath: path.join(dir(), "modules.sock"),
          method: "POST",
          path: "/v1/email",
          timeout: 70_000,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "idempotency-key": key,
          },
        },
        (response) => {
          response.resume();
          const code = response.statusCode ?? 0;
          resolve({
            status:
              code === 200 || code === 202
                ? "sent"
                : [409, 502, 504].includes(code)
                  ? "unknown"
                  : "not-sent",
          });
        },
      );
      sent.on("timeout", () => sent.destroy(new Error("timeout")));
      // Never reached: nothing went. Reached and no answer: it may have gone.
      sent.on("error", (error: { code?: string }) =>
        resolve({
          status: error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "not-sent" : "unknown",
        }),
      );
      sent.end(body);
    });
  },
};

export const STORAGE_OFF =
  "File storage isn't switched on for this app yet, so files can't be uploaded or opened.";

export type Stored = { ok: true; body: Buffer } | { ok: false; off: boolean; message: string };

const SAID: Record<string, string> = {
  FILE_TOO_LARGE: "That file is too large to keep.",
  STORAGE_QUOTA_EXCEEDED: "This app's file storage is full. Remove a file before adding more.",
  STORAGE_DISK_LOW: "File storage is full right now. Try again later.",
};

export function storage(
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
): Promise<Stored> {
  return new Promise((resolve) => {
    let token: string;
    try {
      token = readFileSync(path.join(dir(), "token"), "utf8").trim();
    } catch {
      resolve({ ok: false, off: true, message: STORAGE_OFF });
      return;
    }
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (body)
      Object.assign(headers, {
        "content-type": "application/octet-stream",
        "content-length": body.byteLength,
      });
    const call = request(
      {
        socketPath: path.join(dir(), "modules.sock"),
        method,
        path: `/v1/files/${encodeURIComponent(key)}`,
        headers,
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const all = Buffer.concat(chunks);
          if (status >= 200 && status < 300) return resolve({ ok: true, body: all });
          let code = "";
          try {
            code = String(JSON.parse(all.toString("utf8")).error ?? "");
          } catch {
            /* no detail */
          }
          resolve({
            ok: false,
            off: code === "MODULE_OFF",
            message:
              code === "MODULE_OFF"
                ? STORAGE_OFF
                : (SAID[code] ?? "File storage couldn't do that. Try again later."),
          });
        });
        response.on("error", () =>
          resolve({ ok: false, off: false, message: "File storage did not answer. Try again." }),
        );
      },
    );
    call.on("timeout", () => call.destroy(new Error("timeout")));
    call.on("error", (error: { code?: string }) =>
      resolve({
        ok: false,
        off: error.code === "ENOENT" || error.code === "ECONNREFUSED",
        message:
          error.code === "ENOENT" || error.code === "ECONNREFUSED"
            ? STORAGE_OFF
            : "File storage did not answer. Try again.",
      }),
    );
    call.end(body);
  });
}
