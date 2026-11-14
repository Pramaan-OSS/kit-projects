import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const browserTools =
  process.env.PROJECTS_BROWSER_TEST_MODULE ?? require.resolve("@playwright/test");
const { chromium, expect } = await import(pathToFileURL(browserTools).href);

import { Pool } from "pg";
import { startFakeDoor } from "./fake-door.mjs";

const origin = "http://127.0.0.1:3440",
  secret = randomBytes(32).toString("hex"),
  project = "projects-walk";
if (!process.env.DATABASE_URL) throw Error("Use a disposable migrated DATABASE_URL for the walk.");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
mkdirSync(".evidence", { recursive: true });
const manifest = JSON.parse(readFileSync("pramaan.kit.json", "utf8"));
const dir = path.resolve(".evidence/door"),
  door = await startFakeDoor({ dir });
door.emailOn = false;
door.filesOn = false;
let peakMiB = 0;
const results = [],
  checks = [],
  errors = [];
function pass(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
      ...extra,
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
}
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3440", "-H", "127.0.0.1"],
  {
    env: {
      ...process.env,
      SESSION_SECRET: secret,
      PRAMAAN_PROJECT_ID: project,
      APP_ORIGIN: origin,
      APP_COOKIE_SECURE: "false",
      PRAMAAN_MODULES_DIR: dir,
    },
    stdio: ["ignore", "ignore", "inherit"],
  },
);
const sampler = setInterval(() => {
  try {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/u).map(Number));
    const tree = new Set([child.pid]);
    for (let grow = true; grow; ) {
      grow = false;
      for (const [pid, ppid] of rows)
        if (tree.has(ppid) && !tree.has(pid)) {
          tree.add(pid);
          grow = true;
        }
    }
    peakMiB = Math.max(
      peakMiB,
      Math.round(rows.filter(([pid]) => tree.has(pid)).reduce((s, [, , rss]) => s + rss, 0) / 1024),
    );
  } catch {
    /* process exiting */
  }
}, 200);
let browser;
const contexts = [];
async function context() {
  const c = await browser.newContext({ baseURL: origin });
  contexts.push(c);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return { c, p };
}
async function post(c, route, body) {
  return c.request.post(route, { headers: { origin }, data: body });
}
async function json(c, route) {
  const r = await c.request.get(route);
  expect(r.ok()).toBe(true);
  return r.json();
}
function note(label) {
  checks.push(label);
  console.log(`passed: ${label}`);
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Server did not start.");
  browser = await chromium.launch({ headless: true });
  for (const journey of manifest.journeys.filter((j) => j.status === "ships-working")) {
    const { c, p } = await context();
    const file = JSON.parse(readFileSync(journey.checklist, "utf8"));
    for (const item of file.items)
      for (const step of item.steps) {
        if (step.enterAs === "owner") await p.goto(`/api/account/owner-pass?token=${pass()}`);
        else if (step.goto) await p.goto(step.goto);
        else if (step.fill) await p.getByLabel(step.fill, { exact: true }).fill(step.value);
        else if (step.select)
          await p.getByLabel(step.select, { exact: true }).selectOption({ label: step.option });
        else if (step.click) {
          await p
            .getByRole("button", { name: step.click, exact: true })
            .or(p.getByRole("link", { name: step.click, exact: true }))
            .click();
        } else if (step.expectText)
          await expect(p.getByText(step.expectText, { exact: false }).first()).toBeVisible();
        else throw Error(`Unsupported step ${JSON.stringify(step)}`);
      }
    results.push(journey.id);
    console.log(`journey passed: ${journey.id}`);
    await c.close();
  }
  const { c: owner, p: op } = await context();
  await op.goto(`/api/account/owner-pass?token=${pass()}`);
  await op.goto("/projects");
  await op.getByLabel("Project name", { exact: true }).fill("Release workspace");
  await op.getByRole("button", { name: "Create project", exact: true }).click();
  await op.getByRole("link", { name: "Release workspace", exact: true }).click();
  await expect(op).toHaveURL(/\/projects\/[a-f0-9-]+$/u);
  const pid = new URL(op.url()).pathname.split("/").pop();
  const second = await post(owner, "/api/projects", { name: "Private roadmap" });
  expect(second.status()).toBe(201);
  const other = (await second.json()).id;
  door.emailOn = true;
  door.filesOn = true;
  async function invite(role, email, projectId) {
    const r = await post(owner, "/api/team", { role, email, projectId });
    expect(r.status()).toBe(201);
    expect((await r.json()).delivery).toBe("sent");
    return door.mail
      .find((m) => m.to === email)
      .text.match(/https?:\/\/[^\s]+\/invite#[a-f0-9]{64}/u)[0];
  }
  const tag = randomBytes(4).toString("hex"),
    memberEmail = `member-${tag}@example.test`,
    guestEmail = `guest-${tag}@example.test`;
  const memberLink = await invite("member", memberEmail),
    guestLink = await invite("guest", guestEmail, pid);
  async function join(link) {
    const actor = await context();
    await actor.p.goto(link);
    await actor.p.getByLabel("Choose a password", { exact: true }).fill("Projects walk 2026!");
    await actor.p.getByLabel("Type it again", { exact: true }).fill("Projects walk 2026!");
    await actor.p.getByRole("button", { name: "Accept invite", exact: true }).click();
    await expect(actor.p.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    return actor;
  }
  const member = await join(memberLink),
    guest = await join(guestLink);
  note("member and guest accept emailed invites and sign in");
  // A used invite cannot create another account; a random token fails too.
  expect(
    (
      await post(owner, "/api/invites", { action: "check", token: guestLink.split("#")[1] })
    ).status(),
  ).toBe(410);
  expect(
    (await post(owner, "/api/invites", { action: "check", token: "a".repeat(64) })).status(),
  ).toBe(410);
  note("used and invented invite links refused");
  await op.reload();
  await op.getByRole("button", { name: "Add task", exact: true }).click();
  await op.getByLabel("Task title", { exact: true }).fill("Prepare release");
  await op.getByLabel("Notes", { exact: true }).fill("Bring the checklist.");
  await op.getByLabel("Assignee", { exact: true }).selectOption({ label: memberEmail });
  await op.getByLabel("Due date", { exact: true }).fill("2099-12-20");
  await op.getByLabel("Priority", { exact: true }).selectOption("High");
  await op.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(op.getByText("Assignment email sent.", { exact: true })).toBeVisible();
  expect(
    door.mail.some((m) => m.to === memberEmail && m.subject === "A task was assigned to you"),
  ).toBe(true);
  note("owner assigns a task and member receives notice");
  await member.p.goto(`/projects/${pid}`);
  await expect(
    member.p.getByRole("heading", { name: "Prepare release", exact: true }),
  ).toBeVisible();
  const card = member.p.locator('[data-task="Prepare release"]');
  await card.dragTo(member.p.getByRole("region", { name: "Doing", exact: true }));
  await expect(member.p.getByLabel("Move Prepare release", { exact: true })).toHaveValue(
    (await json(member.c, "/api/projects")).statuses.find((s) => s.name === "Doing").id,
  );
  await member.p.reload();
  await expect(
    member.p
      .getByRole("region", { name: "Doing", exact: true })
      .getByRole("heading", { name: "Prepare release", exact: true }),
  ).toBeVisible();
  note("member drags task to Doing and server keeps it after reload");
  await member.p.goto("/my-tasks");
  await expect(
    member.p.getByRole("heading", { name: "Prepare release", exact: true }),
  ).toBeVisible();
  await member.p.getByLabel("Due filter", { exact: true }).selectOption("upcoming");
  await expect(
    member.p.getByRole("heading", { name: "Prepare release", exact: true }),
  ).toBeVisible();
  note("My tasks filters across projects");
  await guest.p.goto("/projects");
  await expect(guest.p.getByRole("link", { name: "Release workspace", exact: true })).toBeVisible();
  await expect(guest.p.getByRole("link", { name: "Private roadmap", exact: true })).toHaveCount(0);
  await guest.p.getByRole("link", { name: "Release workspace", exact: true }).click();
  await guest.p.getByLabel("Comment", { exact: true }).fill("Guest approves this release.");
  await guest.p.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(guest.p.getByText("Guest approves this release.", { exact: true })).toBeVisible();
  for (const url of [
    `/api/projects/${other}`,
    `/api/tasks?project=${other}`,
    `/api/tasks/export?project=${other}`,
  ])
    expect((await guest.c.request.get(url)).status()).toBe(404);
  expect(
    (await post(guest.c, `/api/projects/${other}`, { body: "Forbidden comment" })).status(),
  ).toBe(404);
  expect((await post(guest.c, "/api/projects", { name: "Forbidden" })).status()).toBe(403);
  expect(
    (await post(member.c, "/api/team", { email: "bad@example.test", role: "member" })).status(),
  ).toBe(403);
  note("guest comments on own project; other project routes and member owner actions refused");
  const tasks = (await json(owner, `/api/tasks?project=${pid}`)).tasks,
    t = tasks.find((t) => t.title === "Prepare release");
  expect(
    (
      await post(guest.c, "/api/tasks", {
        action: "move",
        projectId: pid,
        id: t.id,
        statusId: t.status_id,
        revision: t.revision,
      })
    ).status(),
  ).toBe(403);
  await op.reload();
  await op.getByRole("button", { name: "Attachments for Prepare release", exact: true }).click();
  await op.getByLabel("Task attachment", { exact: true }).setInputFiles({
    name: "release.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private release checklist"),
  });
  await expect(op.getByRole("link", { name: "release.txt", exact: true })).toBeVisible();
  const attachment = await op
    .getByRole("link", { name: "release.txt", exact: true })
    .getAttribute("href");
  const response = await guest.c.request.get(attachment);
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("Private release checklist");
  const stranger = await context();
  expect((await stranger.c.request.get(attachment)).status()).toBe(401);
  note("task attachment upload and authenticated download");
  const header = "Title,Notes,Assignee email,Due date,Priority,Status\n";
  await op.getByLabel("Tasks CSV", { exact: true }).setInputFiles({
    name: "tasks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${header}Imported plan,From CSV,,2026-12-21,Normal,To do`),
  });
  await expect(op.getByRole("heading", { name: "Imported plan", exact: true })).toBeVisible();
  const csv = await owner.request.get(`/api/tasks/export?project=${pid}`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Imported plan");
  note("CSV import from screen and export content");
  // Two sequential sign-ins demonstrate saved credentials rather than only invite-created sessions.
  await member.p.goto("/");
  await member.p.getByRole("button", { name: "Sign out", exact: true }).click();
  await member.p.getByLabel("Email", { exact: true }).fill(memberEmail);
  await member.p.getByLabel("Password", { exact: true }).fill("Projects walk 2026!");
  await member.p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(member.p.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  note("member signs out and signs in with saved password");
  const ownerUser = (await json(owner, "/api/account/session")).user;
  const core = await owner.request.post("/api/account/tasks", {
    headers: { origin, "x-app-user": ownerUser.id },
    data: { action: "create", title: "Owner core action" },
  });
  expect(core.status()).toBe(201);
  const coreTask = (await core.json()).task;
  expect((await json(member.c, "/api/account/tasks")).tasks.some((t) => t.id === coreTask.id)).toBe(
    false,
  );
  expect(
    (
      await post(member.c, "/api/account/tasks", {
        action: "complete",
        id: coreTask.id,
        completed: true,
      })
    ).status(),
  ).toBe(404);
  expect(
    (await post(owner, "/api/account/tasks", { action: "delete", id: coreTask.id })).status(),
  ).toBe(200);
  note("starter owner core action and per-account task isolation");
  const token = pass();
  const probe = await context();
  expect(
    (
      await probe.c.request.get(`/api/account/owner-pass?token=${token}`, { maxRedirects: 0 })
    ).status(),
  ).toBe(303);
  expect(
    (
      await probe.c.request.get(`/api/account/owner-pass?token=${token}`, { maxRedirects: 0 })
    ).status(),
  ).toBe(401);
  for (const bad of [
    pass({ exp: Math.floor(Date.now() / 1000) - 1 }),
    pass({ project: "foreign" }),
    `${pass().slice(0, -1)}!`,
  ])
    expect(
      (
        await stranger.c.request.get(`/api/account/owner-pass?token=${bad}`, { maxRedirects: 0 })
      ).status(),
    ).toBe(401);
  note("owner pass works once; reused, expired, foreign and forged passes refused");
  await op.goto(`/projects/${pid}`);
  await op.screenshot({ path: ".evidence/board-desktop.png", fullPage: true });
  await op.setViewportSize({ width: 390, height: 844 });
  await op.screenshot({ path: ".evidence/board-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  note("desktop/mobile screenshots and no browser exceptions");
} finally {
  clearInterval(sampler);
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  await door.close();
  await db.end();
  writeFileSync(
    ".evidence/walk.json",
    JSON.stringify(
      {
        journeys: results,
        checks,
        errors,
        appPeakMiB: peakMiB,
        memoryMethod: "summed process RSS sampled every 200ms; not a cgroup peak",
      },
      null,
      2,
    ),
  );
  console.log(`App peak RSS: ${peakMiB} MiB`);
}
