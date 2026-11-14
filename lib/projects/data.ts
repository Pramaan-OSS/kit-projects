import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AccountError } from "../accounts";
import { emailDoor, type Mailer } from "../email";
import { database } from "../runtime";
import { editor, owner, project, type Viewer } from "./access";
import { id, notFound, text } from "./words";

export async function transaction<T>(work: (c: PoolClient) => Promise<T>) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const r = await work(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function listProjects(v: Viewer) {
  return (
    await database().query(
      `SELECT p.id,p.name FROM projects p WHERE workspace_id=$1
 AND ($2::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$3)) ORDER BY created_at,id`,
      [v.workspaceId, v.role !== "guest", v.user.id],
    )
  ).rows;
}
export async function addProject(v: Viewer, name: unknown) {
  editor(v);
  const pid = randomUUID();
  await transaction(async (c) => {
    await c.query("INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,$3)", [
      pid,
      v.workspaceId,
      text(name, "a project name", 120),
    ]);
    await c.query("INSERT INTO project_members(workspace_id,project_id,user_id) VALUES($1,$2,$3)", [
      v.workspaceId,
      pid,
      v.user.id,
    ]);
  });
  return { id: pid };
}
export async function statuses(v: Viewer) {
  return (
    await database().query(
      "SELECT id,name,position FROM project_statuses WHERE workspace_id=$1 ORDER BY position,id",
      [v.workspaceId],
    )
  ).rows;
}
export async function people(v: Viewer) {
  if (v.role === "guest") return [];
  return (
    await database().query(
      "SELECT u.id,coalesce(u.email,'The owner') AS email,m.role FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.role<>'guest' ORDER BY email",
      [v.workspaceId],
    )
  ).rows;
}
export async function statusAction(v: Viewer, input: Record<string, unknown>) {
  owner(v);
  try {
    await transaction(async (c) => {
      await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [v.workspaceId]);
      if (input.action === "add") {
        const count = await c.query(
          "SELECT count(*)::int AS n FROM project_statuses WHERE workspace_id=$1",
          [v.workspaceId],
        );
        if (count.rows[0].n >= 30) throw new AccountError(400, "Keep to 30 statuses or fewer.");
        await c.query(
          "INSERT INTO project_statuses(workspace_id,name,position) SELECT $1,$2,coalesce(max(position),0)+1 FROM project_statuses WHERE workspace_id=$1",
          [v.workspaceId, text(input.name, "a status name", 40)],
        );
        return;
      }
      const sid = id(input.id, "That status");
      const all = (
        await c.query(
          "SELECT id FROM project_statuses WHERE workspace_id=$1 ORDER BY position,id",
          [v.workspaceId],
        )
      ).rows.map((r) => r.id as string);
      if (!all.includes(sid)) throw notFound("That status");
      if (input.action === "rename") {
        await c.query("UPDATE project_statuses SET name=$3 WHERE id=$1 AND workspace_id=$2", [
          sid,
          v.workspaceId,
          text(input.name, "a status name", 40),
        ]);
        return;
      }
      if (input.action === "remove") {
        if (all.length === 1) throw new AccountError(409, "Keep at least one status.");
        await c.query("DELETE FROM project_statuses WHERE id=$1 AND workspace_id=$2", [
          sid,
          v.workspaceId,
        ]);
        return;
      }
      if (input.action === "up" || input.action === "down") {
        const i = all.indexOf(sid),
          to = input.action === "up" ? i - 1 : i + 1;
        if (to >= 0 && to < all.length) all.splice(to, 0, ...all.splice(i, 1));
        await c.query(
          "UPDATE project_statuses s SET position=o.n FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,n) WHERE s.id=o.id AND s.workspace_id=$2",
          [all, v.workspaceId],
        );
        return;
      }
      throw new AccountError(400, "Choose what to do with the status.");
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23503")
      throw new AccountError(409, "A task uses this status. Move its tasks first.");
    if (code === "23505") throw new AccountError(409, "A status already has that name.");
    throw e;
  }
}
export async function listTasks(v: Viewer, filters: URLSearchParams) {
  const pid = filters.get("project");
  if (pid) await project(v, pid);
  const status = filters.get("status");
  const assignee = filters.get("assignee");
  const due = filters.get("due") ?? "";
  if (!["", "overdue", "today", "upcoming", "none"].includes(due))
    throw new AccountError(400, "Choose a due date filter.");
  return (
    await database().query(
      `SELECT t.*,t.due_on::text AS due_on,p.name AS project,s.name AS status,coalesce(u.email,'The owner') AS assignee
 FROM project_tasks t JOIN projects p ON p.id=t.project_id JOIN project_statuses s ON s.id=t.status_id LEFT JOIN app_users u ON u.id=t.assignee_id
 WHERE t.workspace_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=t.project_id AND m.user_id=$3))
 AND ($4::uuid IS NULL OR t.project_id=$4) AND ($5::uuid IS NULL OR t.status_id=$5)
 AND ($6::uuid IS NULL OR t.assignee_id=$6) AND ($7::boolean=false OR t.assignee_id=$3)
 AND ($8='' OR ($8='overdue' AND t.due_on<CURRENT_DATE) OR ($8='today' AND t.due_on=CURRENT_DATE) OR ($8='upcoming' AND t.due_on>CURRENT_DATE) OR ($8='none' AND t.due_on IS NULL))
 ORDER BY s.position,t.position,t.id LIMIT 2000`,
      [
        v.workspaceId,
        v.role !== "guest",
        v.user.id,
        pid ? id(pid) : null,
        status ? id(status) : null,
        assignee ? id(assignee) : null,
        filters.get("mine") === "1",
        due,
      ],
    )
  ).rows;
}
export function dueDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new AccountError(400, "Enter a real due date.");
  return value;
}
export async function saveTask(
  v: Viewer,
  input: Record<string, unknown>,
  mailer: Mailer = emailDoor,
) {
  editor(v);
  const p = await project(v, input.projectId);
  const tid = input.id ? id(input.id) : randomUUID();
  const title = text(input.title, "a task title", 240),
    notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > 4000) throw new AccountError(400, "Keep notes to 4,000 characters.");
  const priority = input.priority ?? "Normal";
  if (!["Low", "Normal", "High"].includes(String(priority)))
    throw new AccountError(400, "Choose a priority.");
  const due = dueDate(input.dueOn),
    assignee = input.assigneeId ? id(input.assigneeId) : null;
  const status = id(input.statusId, "That status");
  const changed = await transaction(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [
      p.id,
      v.workspaceId,
    ]);
    if (
      !(
        await c.query("SELECT 1 FROM project_statuses WHERE id=$1 AND workspace_id=$2", [
          status,
          v.workspaceId,
        ])
      ).rowCount
    )
      throw notFound("That status");
    if (
      assignee &&
      !(
        await c.query(
          "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role IN ('owner','member')",
          [v.workspaceId, assignee],
        )
      ).rowCount
    )
      throw new AccountError(400, "Assign a member of this team.");
    if (input.id) {
      const old = (
        await c.query(
          "SELECT assignee_id,revision,status_id FROM project_tasks WHERE id=$1 AND project_id=$2",
          [tid, p.id],
        )
      ).rows[0];
      if (!old) throw notFound("That task");
      if (old.revision !== input.revision)
        throw new AccountError(409, "This task changed. Reload before saving.");
      const r = await c.query(
        "UPDATE project_tasks SET title=$3,notes=$4,assignee_id=$5,due_on=$6,priority=$7,status_id=$8,revision=revision+1,position=CASE WHEN status_id=$8 THEN position ELSE (SELECT coalesce(max(position),0)+1 FROM project_tasks WHERE project_id=$2 AND status_id=$8) END WHERE id=$1 AND project_id=$2 RETURNING revision",
        [tid, p.id, title, notes, assignee, due, priority, status],
      );
      return { notify: assignee !== old.assignee_id, revision: r.rows[0].revision };
    }
    await c.query(
      "INSERT INTO project_tasks(id,workspace_id,project_id,title,notes,assignee_id,due_on,priority,status_id,position) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce(max(position),0)+1 FROM project_tasks WHERE project_id=$3 AND status_id=$9",
      [tid, v.workspaceId, p.id, title, notes, assignee, due, priority, status],
    );
    return { notify: !!assignee, revision: 1 };
  });
  let notice = "No assignment notice needed.";
  if (changed.notify && assignee) {
    const email = (await database().query("SELECT email FROM app_users WHERE id=$1", [assignee]))
      .rows[0]?.email;
    if (email) {
      const result = await mailer.send(
        {
          to: email,
          subject: "A task was assigned to you",
          text: `${title}\nProject: ${p.name}\nSign in to your team projects app to see it.`,
        },
        `task-${tid}-${changed.revision}`,
      );
      notice =
        result.status === "sent"
          ? "Assignment email sent."
          : result.status === "unknown"
            ? "Task saved. Assignment email may have been sent."
            : "Task saved. Email is unavailable; assignment notice was not sent.";
    }
  }
  return { id: tid, notice };
}
export async function moveTask(v: Viewer, input: Record<string, unknown>) {
  editor(v);
  const p = await project(v, input.projectId);
  const tid = id(input.id),
    sid = id(input.statusId);
  await transaction(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [p.id]);
    const task = (
      await c.query("SELECT revision FROM project_tasks WHERE id=$1 AND project_id=$2", [tid, p.id])
    ).rows[0];
    if (!task) throw notFound("That task");
    if (task.revision !== input.revision)
      throw new AccountError(409, "This task changed. Reload before moving it.");
    if (
      !(
        await c.query("SELECT 1 FROM project_statuses WHERE id=$1 AND workspace_id=$2", [
          sid,
          v.workspaceId,
        ])
      ).rowCount
    )
      throw notFound("That status");
    const rows = (
      await c.query(
        "SELECT id FROM project_tasks WHERE project_id=$1 AND status_id=$2 AND id<>$3 ORDER BY position,id",
        [p.id, sid, tid],
      )
    ).rows.map((r) => r.id as string);
    let at = rows.length;
    if (input.beforeId) {
      at = rows.indexOf(id(input.beforeId));
      if (at < 0) throw new AccountError(409, "The board changed. Reload and try again.");
    }
    rows.splice(at, 0, tid);
    await c.query(
      "UPDATE project_tasks SET status_id=$3,revision=revision+1 WHERE id=$1 AND project_id=$2",
      [tid, p.id, sid],
    );
    await c.query(
      "UPDATE project_tasks t SET position=o.n FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,n) WHERE t.id=o.id AND t.project_id=$2",
      [rows, p.id],
    );
  });
}
export async function comments(v: Viewer, pid: unknown) {
  const p = await project(v, pid);
  return (
    await database().query(
      "SELECT c.id,c.body,c.created_at,coalesce(u.email,'The owner') AS author FROM project_comments c JOIN app_users u ON u.id=c.author_id WHERE c.project_id=$1 ORDER BY c.created_at,c.id",
      [p.id],
    )
  ).rows;
}
export async function comment(v: Viewer, pid: unknown, body: unknown) {
  const p = await project(v, pid);
  await database().query(
    "INSERT INTO project_comments(id,project_id,author_id,body) VALUES($1,$2,$3,$4)",
    [randomUUID(), p.id, v.user.id, text(body, "a comment", 4000)],
  );
}
