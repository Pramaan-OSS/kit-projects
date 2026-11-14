import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const draft = process.argv.includes("--draft"),
  origin = "http://127.0.0.1:3442",
  began = Date.now();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    draft ? "dev" : "start",
    ...(draft ? ["--webpack", "--disable-source-maps"] : []),
    "-p",
    "3442",
    "-H",
    "0.0.0.0",
  ],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: draft ? "development" : "production" } },
);
try {
  let ready = false;
  for (let i = 0; i < 480; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw Error("Server did not answer within 120 seconds.");
  const firstAnswerSeconds = Math.max(1, Math.ceil((Date.now() - began) / 1000)),
    now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project: process.env.PRAMAAN_PROJECT_ID,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  const token = `${body}.${createHmac("sha256", process.env.SESSION_SECRET).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
  const response = await fetch(`${origin}/api/account/owner-pass?token=${token}`, {
    redirect: "manual",
  });
  if (response.status !== 303) throw Error("Owner pass failed.");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const manifest = JSON.parse(await readFile("pramaan.kit.json", "utf8"));
  for (const { route } of manifest.entryPoints) {
    const r = await fetch(origin + route, { headers: { cookie } });
    if (r.status >= 400) throw Error(`Page failed: ${route}`);
  }
  const headers = { cookie, origin, "content-type": "application/json" };
  const p = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Memory measurement project" }),
  });
  if (p.status !== 201) throw Error("Project creation failed.");
  const { id } = await p.json();
  for (const route of [`/projects/${id}`, `/api/projects/${id}`, `/api/tasks?project=${id}`])
    if (!(await fetch(origin + route, { headers: { cookie } })).ok)
      throw Error(`Route failed: ${route}`);
  const peakBytes = Number(await readFile("/sys/fs/cgroup/memory.peak", "utf8"));
  await writeFile(
    `/results/${draft ? "draft" : "browser"}-measured.json`,
    JSON.stringify({
      peakBytes,
      firstAnswerSeconds,
      seconds: Math.ceil((Date.now() - began) / 1000),
    }),
  );
} finally {
  child.kill("SIGTERM");
}
