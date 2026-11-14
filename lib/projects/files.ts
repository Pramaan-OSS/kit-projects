import { randomUUID } from "node:crypto";
import { AccountError } from "../accounts";
import { storage } from "../modules";
import { database } from "../runtime";
import { editor, project, type Viewer } from "./access";
import { id, notFound, text } from "./words";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export async function taskAccess(v: Viewer, tid: unknown) {
  const row = (
    await database().query(
      "SELECT id,project_id FROM project_tasks WHERE id=$1 AND workspace_id=$2",
      [id(tid), v.workspaceId],
    )
  ).rows[0];
  if (!row) throw notFound("That task");
  await project(v, row.project_id);
  return row;
}
export async function attachments(v: Viewer, tid: unknown) {
  await taskAccess(v, tid);
  return (
    await database().query(
      "SELECT id,name,size_bytes FROM task_attachments WHERE task_id=$1 ORDER BY created_at,id",
      [tid],
    )
  ).rows;
}
export async function readFileBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "Choose a nonempty file.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new AccountError(413, "Files can be at most 10 MB.");
      }
      parts.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new AccountError(400, "Choose a nonempty file.");
  return Buffer.concat(parts);
}
export async function upload(v: Viewer, tid: unknown, rawName: unknown, bytes: Buffer) {
  editor(v);
  await taskAccess(v, tid);
  const name = text(rawName, "a file name", 200).replace(/[\\/\p{Cc}]/gu, "_");
  const fid = randomUUID();
  const sent = await storage("PUT", `projects/${fid}`, bytes);
  if (!sent.ok) throw new AccountError(503, sent.message);
  try {
    await database().query(
      "INSERT INTO task_attachments(id,task_id,name,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5)",
      [fid, tid, name, bytes.byteLength, v.user.id],
    );
  } catch (e) {
    await storage("DELETE", `projects/${fid}`);
    throw e;
  }
  return { id: fid };
}
export async function download(v: Viewer, fid: unknown) {
  const f = (
    await database().query("SELECT id,task_id,name FROM task_attachments WHERE id=$1", [id(fid)])
  ).rows[0];
  if (!f) throw notFound("That file");
  await taskAccess(v, f.task_id);
  const r = await storage("GET", `projects/${f.id}`);
  if (!r.ok) throw new AccountError(503, r.message);
  return { name: f.name as string, body: r.body };
}
