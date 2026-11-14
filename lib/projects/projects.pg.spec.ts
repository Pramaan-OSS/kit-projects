import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../runtime";
import { type Viewer, workspaceFor } from "./access";
import { parseCsv } from "./csv";
import { addProject, listTasks, saveTask, statuses } from "./data";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw Error("Projects tests require a disposable DATABASE_URL with migrations applied.");
const secret = "test-secret-".repeat(4),
  origin = "http://localhost";
const dir = mkdtempSync(path.join(tmpdir(), "projects-test-"));
Object.assign(process.env, {
  DATABASE_URL: url,
  SESSION_SECRET: secret,
  APP_ORIGIN: origin,
  APP_COOKIE_SECURE: "false",
  PRAMAAN_MODULES_DIR: dir,
});
const { startFakeDoor } = await import(
  new URL("../../scripts/fake-door.mjs", import.meta.url).href
);
const projects = await import("../../app/api/projects/route");
const taskRoute = await import("../../app/api/tasks/route");
const one = await import("../../app/api/projects/[id]/route");
const team = await import("../../app/api/team/route");
const invites = await import("../../app/api/invites/route");
const statusRoute = await import("../../app/api/statuses/route");
const csvRoute = await import("../../app/api/tasks/export/route");
const fileRoute = await import("../../app/api/tasks/[id]/files/route");
const downloadRoute = await import("../../app/api/files/[id]/route");
const noMail = {
  send: async () => ({ status: "not-sent" as const, reason: "off", message: "Email off" }),
};
type Actor = { id: string; cookie: string; v: Viewer };
let own: Actor,
  member: Actor,
  guest: Actor,
  foreign: Actor,
  pid: string,
  other: string,
  tid: string,
  sid: string,
  doing: string;
let door: Awaited<ReturnType<typeof startFakeDoor>>;
const users: string[] = [];
async function actor(role: "owner" | "member" | "guest", workspaceId?: string): Promise<Actor> {
  const id = randomUUID();
  users.push(id);
  await database().query("INSERT INTO app_users(id,email,role) VALUES($1,$2,$3)", [
    id,
    `${id}@example.test`,
    role,
  ]);
  if (!workspaceId && role !== "owner") {
    workspaceId = randomUUID();
    await database().query("INSERT INTO workspaces(id,owner_id) VALUES($1,$2)", [workspaceId, id]);
    await database().query(
      "INSERT INTO project_statuses(workspace_id,name,position) VALUES($1,'Foreign status',1)",
      [workspaceId],
    );
  }
  if (workspaceId)
    await database().query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)",
      [workspaceId, id, role],
    );
  const token = randomBytes(32).toString("hex");
  await database().query(
    "INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [createHmac("sha256", secret).update(token).digest("hex"), id],
  );
  return {
    id,
    cookie: `app_session=${token}`,
    v: await workspaceFor({ id, email: `${id}@example.test`, role }),
  };
}
function req(
  actor: Actor | undefined,
  route: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(origin + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(actor ? { cookie: actor.cookie } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const task = (extra: Record<string, unknown> = {}) => ({
  action: "save",
  projectId: pid,
  title: "Ship the plan",
  notes: "First draft",
  priority: "High",
  statusId: sid,
  assigneeId: member.id,
  dueOn: "2099-12-20",
  ...extra,
});
beforeAll(async () => {
  door = await startFakeDoor({ dir });
  own = await actor("owner");
  foreign = await actor("member");
  member = await actor("member", own.v.workspaceId);
  guest = await actor("guest", own.v.workspaceId);
  pid = (await addProject(own.v, "Shared project")).id;
  other = (await addProject(own.v, "Private project")).id;
  await database().query(
    "INSERT INTO project_members(workspace_id,project_id,user_id) VALUES($1,$2,$3)",
    [own.v.workspaceId, pid, guest.id],
  );
  const s = await statuses(own.v);
  sid = s[0]?.id;
  doing = s[1]?.id;
  tid = (await saveTask(own.v, task(), noMail)).id;
});
afterAll(async () => {
  // Every test owns only these fixture workspaces; never truncate a shared database.
  const w = [own?.v.workspaceId, foreign?.v.workspaceId].filter(Boolean);
  await database().query(
    "DELETE FROM task_attachments WHERE task_id IN(SELECT id FROM project_tasks WHERE workspace_id=ANY($1::uuid[]))",
    [w],
  );
  await database().query(
    "DELETE FROM project_comments WHERE project_id IN(SELECT id FROM projects WHERE workspace_id=ANY($1::uuid[]))",
    [w],
  );
  await database().query("DELETE FROM project_invites WHERE workspace_id=ANY($1::uuid[])", [w]);
  await database().query("DELETE FROM project_tasks WHERE workspace_id=ANY($1::uuid[])", [w]);
  await database().query("DELETE FROM project_members WHERE workspace_id=ANY($1::uuid[])", [w]);
  const invited = await database().query(
    "DELETE FROM workspace_members WHERE workspace_id=ANY($1::uuid[]) RETURNING user_id",
    [w],
  );
  await database().query("DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])", [w]);
  await database().query("DELETE FROM project_statuses WHERE workspace_id=ANY($1::uuid[])", [w]);
  await database().query("DELETE FROM workspaces WHERE id=ANY($1::uuid[])", [w]);
  await database().query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [
    [...users, ...invited.rows.map((r) => r.user_id)],
  ]);
  await door?.close();
  await database().end();
  rmSync(dir, { recursive: true, force: true });
});
describe("Project permissions through HTTP handlers", () => {
  it("rejects signed-out reads", async () => {
    expect((await projects.GET(req(undefined, "/api/projects"))).status).toBe(401);
  });
  it("guest sees only their project in lists", async () => {
    const body = await (await projects.GET(req(guest, "/api/projects"))).json();
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([pid]);
  });
  it("guest gets 404 on another project", async () => {
    expect((await one.GET(req(guest, `/api/projects/${other}`), params(other))).status).toBe(404);
  });
  it("guest cannot create a project", async () => {
    expect((await projects.POST(req(guest, "/api/projects", { name: "Forbidden" }))).status).toBe(
      403,
    );
  });
  it("guest can comment on their project", async () => {
    expect(
      (await one.POST(req(guest, `/api/projects/${pid}`, { body: "Looks good" }), params(pid)))
        .status,
    ).toBe(201);
    const body = await (await one.GET(req(own, `/api/projects/${pid}`), params(pid))).json();
    expect(body.comments.some((c: { body: string }) => c.body === "Looks good")).toBe(true);
  });
  it("guest cannot comment elsewhere", async () => {
    expect(
      (await one.POST(req(guest, `/api/projects/${other}`, { body: "Leak" }), params(other)))
        .status,
    ).toBe(404);
  });
  it("foreign workspace cannot read or edit a project", async () => {
    expect((await one.GET(req(foreign, `/api/projects/${pid}`), params(pid))).status).toBe(404);
    expect((await taskRoute.POST(req(foreign, "/api/tasks", task()))).status).toBe(404);
  });
  it("guest cannot change tasks", async () => {
    expect((await taskRoute.POST(req(guest, "/api/tasks", task()))).status).toBe(403);
  });
  it("member cannot invite or change statuses", async () => {
    expect(
      (await team.POST(req(member, "/api/team", { email: "no@example.test", role: "member" })))
        .status,
    ).toBe(403);
    expect(
      (await statusRoute.POST(req(member, "/api/statuses", { action: "add", name: "Denied" })))
        .status,
    ).toBe(403);
  });
  it("cross-origin writes are refused", async () => {
    expect(
      (
        await projects.POST(
          req(own, "/api/projects", { name: "Bad" }, { origin: "http://elsewhere.test" }),
        )
      ).status,
    ).toBe(403);
  });
  it("public sign-up is disabled", async () => {
    const account = await import("../../app/api/account/[action]/route");
    expect(
      (
        await account.POST(
          req(undefined, "/api/account/signup", {
            email: "new@example.test",
            password: "very-long-password",
          }),
          { params: Promise.resolve({ action: "signup" }) },
        )
      ).status,
    ).toBe(404);
  });
});
describe("Task state and order", () => {
  it("keeps status in use and allows unused removal", async () => {
    expect(
      (await statusRoute.POST(req(own, "/api/statuses", { action: "remove", id: sid }))).status,
    ).toBe(409);
    expect(
      (await statusRoute.POST(req(own, "/api/statuses", { action: "add", name: "Unused" }))).status,
    ).toBe(200);
    const s = (await statuses(own.v)).find((s) => s.name === "Unused");
    expect(
      (await statusRoute.POST(req(own, "/api/statuses", { action: "remove", id: s?.id }))).status,
    ).toBe(200);
  });
  it("member moves a task and stale moves are rejected", async () => {
    const body = { action: "move", projectId: pid, id: tid, statusId: doing, revision: 1 };
    expect((await taskRoute.POST(req(member, "/api/tasks", body))).status).toBe(200);
    expect((await taskRoute.POST(req(member, "/api/tasks", body))).status).toBe(409);
    const row = await database().query("SELECT status_id FROM project_tasks WHERE id=$1", [tid]);
    expect(row.rows[0].status_id).toBe(doing);
  });
  it("preserves insertion order on server", async () => {
    const second = (await saveTask(own.v, task({ title: "Second" }), noMail)).id;
    expect(
      (
        await taskRoute.POST(
          req(member, "/api/tasks", {
            action: "move",
            projectId: pid,
            id: second,
            statusId: doing,
            beforeId: tid,
            revision: 1,
          }),
        )
      ).status,
    ).toBe(200);
    const rows = await database().query(
      "SELECT id FROM project_tasks WHERE project_id=$1 AND status_id=$2 ORDER BY position,id",
      [pid, doing],
    );
    expect(rows.rows.map((r) => r.id)).toEqual([second, tid]);
  });
  it("concurrent moves of the same revision allow only one", async () => {
    const t = (await saveTask(own.v, task({ title: "Race" }), noMail)).id;
    const body = { action: "move", projectId: pid, id: t, statusId: doing, revision: 1 };
    const results = await Promise.all([
      taskRoute.POST(req(member, "/api/tasks", body)),
      taskRoute.POST(req(member, "/api/tasks", body)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("rejects foreign statuses, foreign assignees and guest assignees", async () => {
    const f = (await statuses(foreign.v))[0]?.id;
    expect((await taskRoute.POST(req(own, "/api/tasks", task({ statusId: f })))).status).toBe(404);
    for (const assigneeId of [foreign.id, guest.id])
      expect((await taskRoute.POST(req(own, "/api/tasks", task({ assigneeId })))).status).toBe(400);
  });
  it("editing a title keeps order and a stale edit changes nothing", async () => {
    const taskId = (await saveTask(own.v, task({ title: "Before edit" }), noMail)).id;
    await saveTask(own.v, task({ title: "After it" }), noMail);
    const before = (
      await database().query("SELECT position FROM project_tasks WHERE id=$1", [taskId])
    ).rows[0].position;
    expect(
      (
        await taskRoute.POST(
          req(member, "/api/tasks", task({ id: taskId, revision: 1, title: "Edited title" })),
        )
      ).status,
    ).toBe(200);
    expect(
      (await database().query("SELECT position FROM project_tasks WHERE id=$1", [taskId])).rows[0]
        .position,
    ).toBe(before);
    expect(
      (
        await taskRoute.POST(
          req(member, "/api/tasks", task({ id: taskId, revision: 1, title: "Stale title" })),
        )
      ).status,
    ).toBe(409);
    expect(
      (await database().query("SELECT title FROM project_tasks WHERE id=$1", [taskId])).rows[0]
        .title,
    ).toBe("Edited title");
  });
  it("CSV assignment notices use the email module", async () => {
    const csv = `Title,Notes,Assignee email,Due date,Priority,Status\nAssigned import,,${member.id}@example.test,,Normal,To do`;
    const response = await taskRoute.POST(
      req(own, "/api/tasks", { action: "import", projectId: pid, csv }),
    );
    expect(response.status).toBe(200);
    expect(
      door.mail.some(
        (m: { to: string; subject: string }) =>
          m.to === `${member.id}@example.test` && m.subject === "Tasks were assigned to you",
      ),
    ).toBe(true);
  });
  it("rejects invalid dates and priorities", async () => {
    expect(
      (await taskRoute.POST(req(own, "/api/tasks", task({ dueOn: "2026-02-31" })))).status,
    ).toBe(400);
    expect(
      (await taskRoute.POST(req(own, "/api/tasks", task({ priority: "Critical" })))).status,
    ).toBe(400);
  });
  it("filters My tasks, assignee, status and due on server", async () => {
    const q = new URLSearchParams({
      mine: "1",
      assignee: member.id,
      status: doing,
      due: "upcoming",
    });
    const tasks = await listTasks(member.v, q);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.assignee_id === member.id && t.status_id === doing)).toBe(true);
    expect(await listTasks(own.v, new URLSearchParams({ mine: "1" }))).toEqual([]);
  });
  it("sends assignment notice through the fake module", async () => {
    const response = await taskRoute.POST(req(own, "/api/tasks", task({ title: "Email notice" })));
    expect(response.status).toBe(200);
    expect(
      door.mail.some((m: { subject: string }) => m.subject === "A task was assigned to you"),
    ).toBe(true);
  });
});
describe("Invites, CSV and attachments", () => {
  it("emailed invite creates the named role and works once", async () => {
    const email = `join-${randomUUID()}@example.test`;
    const sent = await team.POST(req(own, "/api/team", { role: "guest", projectId: pid, email }));
    expect(sent.status).toBe(201);
    const mail = door.mail.find((m: { to: string }) => m.to === email);
    const token = mail.text.match(/invite#([a-f0-9]{64})/u)[1];
    expect(
      (
        await invites.POST(
          req(undefined, "/api/invites", {
            action: "accept",
            token,
            password: "a-very-long-password",
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await invites.POST(
          req(undefined, "/api/invites", {
            action: "accept",
            token,
            password: "a-very-long-password",
          }),
        )
      ).status,
    ).toBe(410);
    const u = (
      await database().query(
        "SELECT u.role,p.project_id FROM app_users u JOIN project_members p ON p.user_id=u.id WHERE u.email=$1",
        [email],
      )
    ).rows[0];
    expect(u).toEqual({ role: "guest", project_id: pid });
  });
  it("reissued and expired links are refused", async () => {
    door.emailOn = false;
    const email = `replace-${randomUUID()}@example.test`;
    const create = async () =>
      await (await team.POST(req(own, "/api/team", { role: "member", email }))).json();
    const first = await create();
    const second = await create();
    expect(first.delivery).toBe("not-sent");
    const token = first.link.split("#")[1];
    expect(
      (await invites.POST(req(undefined, "/api/invites", { action: "check", token }))).status,
    ).toBe(410);
    await database().query(
      "UPDATE project_invites SET expires_at=now()-interval '1 second' WHERE email=$1",
      [email],
    );
    expect(
      (
        await invites.POST(
          req(undefined, "/api/invites", { action: "check", token: second.link.split("#")[1] }),
        )
      ).status,
    ).toBe(410);
    door.emailOn = true;
  });
  it("CSV supports quoted commas and line breaks", () => {
    expect(parseCsv('"a,b","line\nnext"\r\n"quote""here",x')).toEqual([
      ["a,b", "line\nnext"],
      ['quote"here', "x"],
    ]);
    expect(() => parseCsv('"unfinished')).toThrow();
  });
  it("imports atomically and defuses spreadsheet formulas on export", async () => {
    const header = "Title,Notes,Assignee email,Due date,Priority,Status\n";
    const bad = `${header}Good,,,,Normal,To do\nBad,,,,Normal,Missing`;
    const count = Number(
      (await database().query("SELECT count(*) FROM project_tasks WHERE project_id=$1", [pid]))
        .rows[0].count,
    );
    expect(
      (await taskRoute.POST(req(own, "/api/tasks", { action: "import", projectId: pid, csv: bad })))
        .status,
    ).toBe(400);
    expect(
      Number(
        (await database().query("SELECT count(*) FROM project_tasks WHERE project_id=$1", [pid]))
          .rows[0].count,
      ),
    ).toBe(count);
    expect(
      (
        await taskRoute.POST(
          req(own, "/api/tasks", {
            action: "import",
            projectId: pid,
            csv: `${header}=SUM(1),,,,Normal,To do`,
          }),
        )
      ).status,
    ).toBe(200);
    const exported = await (
      await csvRoute.GET(req(own, `/api/tasks/export?project=${pid}`))
    ).text();
    expect(exported).toContain("'=SUM(1)");
    expect((await csvRoute.GET(req(guest, `/api/tasks/export?project=${other}`))).status).toBe(404);
  });
  it("uploads and downloads attachments only for allowed projects", async () => {
    const r = new Request(`${origin}/api/tasks/${tid}/files`, {
      method: "POST",
      headers: { origin, cookie: own.cookie, "x-file-name": "plan.txt" },
      body: "A private plan",
    });
    const response = await fileRoute.POST(r, params(tid));
    expect(response.status).toBe(201);
    const file = await response.json();
    expect(
      (await downloadRoute.GET(req(foreign, `/api/files/${file.id}`), params(file.id))).status,
    ).toBe(404);
    const good = await downloadRoute.GET(req(guest, `/api/files/${file.id}`), params(file.id));
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("A private plan");
    expect(good.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("guest cannot read another project's task or attachment", async () => {
    const hidden = (await saveTask(own.v, task({ projectId: other, title: "Hidden task" }), noMail))
      .id;
    const uploadRequest = new Request(`${origin}/api/tasks/${hidden}/files`, {
      method: "POST",
      headers: { origin, cookie: own.cookie, "x-file-name": "hidden.txt" },
      body: "Hidden bytes",
    });
    const made = await fileRoute.POST(uploadRequest, params(hidden));
    expect(made.status).toBe(201);
    const f = await made.json();
    expect((await downloadRoute.GET(req(guest, `/api/files/${f.id}`), params(f.id))).status).toBe(
      404,
    );
    expect(
      (await fileRoute.GET(req(guest, `/api/tasks/${hidden}/files`), params(hidden))).status,
    ).toBe(404);
    const rows = await listTasks(guest.v, new URLSearchParams());
    expect(rows.some((t) => t.id === hidden)).toBe(false);
  });
  it("module off returns an honest error and stores no attachment", async () => {
    door.filesOn = false;
    const r = new Request(`${origin}/api/tasks/${tid}/files`, {
      method: "POST",
      headers: { origin, cookie: own.cookie, "x-file-name": "missing.txt" },
      body: "not stored",
    });
    const response = await fileRoute.POST(r, params(tid));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("isn't switched on");
    expect(
      (
        await database().query(
          "SELECT 1 FROM task_attachments WHERE name='missing.txt' AND task_id=$1",
          [tid],
        )
      ).rowCount,
    ).toBe(0);
    door.filesOn = true;
  });
});
