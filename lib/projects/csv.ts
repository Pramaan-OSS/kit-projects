import { createHash, randomUUID } from "node:crypto";
import { AccountError } from "../accounts";
import { emailDoor } from "../email";
import type { Viewer } from "./access";
import { editor, project } from "./access";
import { dueDate, listTasks, transaction } from "./data";
import { csvCell, text } from "./words";

const HEADER = ["Title", "Notes", "Assignee email", "Due date", "Priority", "Status"];
export function parseCsv(source: string): string[][] {
  if (Buffer.byteLength(source) > 12000)
    throw new AccountError(413, "Import at most 12 KB at once.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (ch !== ",") {
        if (ch === "\r" && source[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
      continue;
    }
    if (ch === '"' && cell === "" && !closed) {
      quoted = true;
      continue;
    }
    if (closed || ch === '"') throw new AccountError(400, "Check the CSV quotes.");
    cell += ch;
  }
  if (quoted) throw new AccountError(400, "Close the CSV quotes.");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export async function exportCsv(v: Viewer, filters: URLSearchParams) {
  const rows = await listTasks(v, filters);
  return [
    HEADER,
    ...rows.map((r) => [
      r.title,
      r.notes,
      r.assignee_id ? r.assignee : "",
      r.due_on ? new Date(r.due_on).toISOString().slice(0, 10) : "",
      r.priority,
      r.status,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
export async function importCsv(v: Viewer, pid: unknown, source: unknown) {
  editor(v);
  const p = await project(v, pid);
  if (typeof source !== "string") throw new AccountError(400, "Choose a CSV file.");
  const rows = parseCsv(source.replace(/^\uFEFF/u, ""));
  if (JSON.stringify(rows.shift()) !== JSON.stringify(HEADER))
    throw new AccountError(400, `Use these CSV columns: ${HEADER.join(", ")}.`);
  if (!rows.length || rows.length > 100)
    throw new AccountError(400, "Import between 1 and 100 tasks at once.");
  // Resolve all values before writing. One bad row rolls back the whole import.
  const notices = new Map<string, string[]>();
  const batch = randomUUID();
  const result = await transaction(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [p.id]);
    const statuses = (
      await c.query("SELECT id,name FROM project_statuses WHERE workspace_id=$1", [v.workspaceId])
    ).rows;
    const members = (
      await c.query(
        "SELECT u.id,u.email FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE workspace_id=$1 AND m.role<>'guest'",
        [v.workspaceId],
      )
    ).rows;
    for (const row of rows) {
      if (row.length !== 6) throw new AccountError(400, "Each task must have six CSV columns.");
      const [rawTitle = "", notes = "", address = "", date = "", priority = "", statusName = ""] =
        row;
      const title = text(rawTitle, "a task title", 240);
      if (notes.length > 4000 || !["Low", "Normal", "High"].includes(priority))
        throw new AccountError(400, "Check the task notes and priority.");
      const status = statuses.find((s) => s.name === statusName),
        member = members.find((m) => m.email?.toLowerCase() === address.toLowerCase());
      if (!status || (address && !member))
        throw new AccountError(
          400,
          "Every CSV status and assignee must already belong to this team.",
        );
      if (member?.email) {
        const titles = notices.get(member.email) ?? [];
        titles.push(title);
        notices.set(member.email, titles);
      }
      await c.query(
        "INSERT INTO project_tasks(id,workspace_id,project_id,title,notes,assignee_id,due_on,priority,status_id,position) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce(max(position),0)+1 FROM project_tasks WHERE project_id=$3 AND status_id=$9",
        [
          randomUUID(),
          v.workspaceId,
          p.id,
          title,
          notes,
          member?.id ?? null,
          dueDate(date),
          priority,
          status.id,
        ],
      );
    }
    return {
      imported: rows.length,
      notice: "Tasks imported.",
    };
  });
  let sent = 0,
    unknown = 0;
  for (const [email, titles] of notices) {
    const r = await emailDoor.send(
      {
        to: email,
        subject: "Tasks were assigned to you",
        text: `Project: ${p.name}\n${titles.join("\n")}\nSign in to your team projects app to see them.`,
      },
      `import-${batch}-${createHash("sha256").update(email).digest("hex")}`,
    );
    if (r.status === "sent") sent++;
    else if (r.status === "unknown") unknown++;
  }
  if (notices.size)
    result.notice +=
      sent === notices.size
        ? " Assignment emails sent."
        : unknown
          ? " Some assignment emails may have been sent."
          : " Email is unavailable; some assignment notices were not sent.";
  return result;
}
