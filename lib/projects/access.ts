import { randomUUID } from "node:crypto";
import { AccountError, type User } from "../accounts";
import { accountRuntime, database } from "../runtime";
import { id, notFound } from "./words";

export type Viewer = { user: User; workspaceId: string; role: "owner" | "member" | "guest" };
export async function workspaceFor(user: User): Promise<Viewer> {
  if (user.role === "owner") {
    const c = await database().connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [user.id]);
      const row = await c.query(
        "INSERT INTO workspaces(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET owner_id=excluded.owner_id RETURNING id",
        [randomUUID(), user.id],
      );
      const wid = row.rows[0].id as string;
      await c.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
        [wid, user.id],
      );
      // Seed only a new workspace, never put back an intentionally removed status.
      const exists = await c.query("SELECT 1 FROM project_statuses WHERE workspace_id=$1", [wid]);
      if (!exists.rowCount)
        await c.query(
          "INSERT INTO project_statuses(workspace_id,name,position) VALUES($1,'To do',1),($1,'Doing',2),($1,'Done',3)",
          [wid],
        );
      await c.query("COMMIT");
      return { user, workspaceId: wid, role: "owner" };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  const row = await database().query(
    "SELECT workspace_id,role FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1",
    [user.id],
  );
  if (!row.rows[0]) throw new AccountError(403, "This account has no team access.");
  return { user, workspaceId: row.rows[0].workspace_id, role: row.rows[0].role };
}
export async function viewer(request: Request) {
  return workspaceFor(await accountRuntime().requireUser(request));
}
export function editor(v: Viewer) {
  if (v.role === "guest")
    throw new AccountError(403, "Guests can view and comment on their project only.");
}
export function owner(v: Viewer) {
  if (v.role !== "owner") throw new AccountError(403, "Only the owner can do this.");
}
export async function project(v: Viewer, projectId: unknown) {
  const rows = await database().query(
    `SELECT p.id,p.name FROM projects p WHERE p.id=$1 AND p.workspace_id=$2
  AND ($3::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$4))`,
    [id(projectId, "That project"), v.workspaceId, v.role !== "guest", v.user.id],
  );
  if (!rows.rows[0]) throw notFound("That project");
  return rows.rows[0] as { id: string; name: string };
}
