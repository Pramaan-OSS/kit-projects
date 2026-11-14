# Team projects and tasks

## Where things live

One Next.js app with pnpm. Records are Postgres rows. Members work across the workspace; guests reach only their invited project.

- `lib/accounts.ts`: unchanged starter accounts and owner pass. `lib/email.ts`: email types and client re-export. `lib/modules.ts`: the single server client for email and private file storage. `lib/runtime.ts`: shared pool and invite-only sign-in settings.
- `lib/projects/access.ts`: resolves workspace membership from the signed-in account. `project` enforces project membership for guests; missing and forbidden projects both answer 404. `editor` refuses guest changes; `owner` protects invites and status settings.
- `lib/projects/data.ts`: workspace-scoped project/task/status queries, comments, task edits and board moves. Project row locks serialize ordering; revisions reject stale task edits. Foreign keys prevent removing statuses used by tasks.
- `lib/projects/invites.ts`: seven-day, one-use, hashed invite tokens bound to email, workspace, role and guest project. Account creation and token consumption share a transaction. `lib/projects/origin.ts`: trusted link origin.
- `lib/projects/csv.ts`: quoted CSV parser, atomic import with team/status validation, scoped export and spreadsheet formula protection. `lib/projects/words.ts`: bounded text, email and identifier checks.
- `lib/projects/files.ts`: authenticated task attachments, bounded upload and download permission checks.
- `lib/roles/http.ts`: same-origin bounded JSON writes and safe error responses. `lib/pramaan/client.ts`: browser request and resource hooks. `lib/pramaan/password-reset*`: registry reset adapter for starter actions.
- Pages: `/` sign-in, `/projects` projects, `/projects/[id]` task board/list and comments, `/my-tasks` assigned work, `/team` invites, `/statuses` settings, `/invite` acceptance, `/owner` owner settings, `/password-reset` and `/reset-password` reset forms.
- `app/task-panel.tsx`: board drag/drop, accessible move controls, filters, task editor, CSV and attachment controls. `app/parts.tsx`: form helpers and plain invite outcomes. `app/shell.tsx`: role-aware navigation. `app/theme.css`: bundled theme and task layout.
- API routes: `/api/projects` and `/api/projects/[id]`; `/api/tasks` and `/api/tasks/export`; `/api/team`; `/api/invites`; `/api/statuses`; `/api/tasks/[id]/files`; `/api/files/[id]`. Each authenticates on the server. `/api/account/[action]` and `/api/health` are starter routes.
- `src/db/migrations/0001`–`0004`: starter unchanged. `0100-projects.sql`: workspace, membership, status, project, task, comment, invite and attachment tables. Add new migrations from `0101`; never edit an applied migration.
- `lib/projects/projects.pg.spec.ts`: real database permissions, board race, invites, CSV and module tests. `scripts/fake-door.mjs`: fake email/files only for tests. `scripts/walk.mjs`: headless checklists, role journeys and owner-pass refusal checks. `scripts/check-contract.mjs`: platform contract/licence checks.

## Add a field

For task effort, add `0101-task-effort.sql` with `ALTER TABLE project_tasks ADD COLUMN effort integer CHECK(effort BETWEEN 1 AND 100);`. Validate and save it in `saveTask`, select it in `listTasks`, add a labelled control to `app/task-panel.tsx`, and test a valid and invalid value in `projects.pg.spec.ts`. Keep workspace and project checks intact.

## Add a page

Add `app/<name>/page.tsx` plus `pramaan.feature.json` with routes and navigation. Run `pnpm generate`. Its API authenticates using `viewer` and scopes queries by the resolved workspace; project rows also use `project`. Add the link for permitted roles to `app/shell.tsx` and a journey test.

## Add a role

Roles are stored in `app_users.role` and `workspace_members.role`. A new migration widens both checks and the invite role check. Only the owner grants roles through `/api/team`; acceptance uses the saved invite, never a role from the browser. Update `Viewer`, `workspaceFor`, `editor` and `owner` checks in access.ts, or use starter `requireRole` for an account-only action. Add refusal tests for every inaccessible project and action.

## Journeys that ship working

- create-project: create a team project.
- manage-task: add a task, move its status and filter the list.
- invite-member: prepare a one-use member invite with honest email-off feedback.
- invite-guest: bind an invite to one project.
- edit-statuses: add, rename, reorder and remove unused statuses.
- owner-settings: enter owner settings through the owner pass.
- signed-out: refuse project data without sign-in.
- my-tasks: open assigned work across projects.

Member/guest emailed acceptance, assignment notices and attachments need platform modules. Tests and the headless walk exercise them with a fake module door. Live paid calls are never used. CSV and cross-role isolation are verified by the walk and tests because checklists cannot inspect downloads or switch identities.

## Checks and limits

Use the starter's pinned Node and pnpm versions. `node scripts/migrate.mjs`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `node scripts/check-contract.mjs`, `node scripts/walk.mjs`. Tests require a disposable migrated `DATABASE_URL` and never skip for missing storage. Files are at most 10 MB; CSV at most 100 rows and 12 KB; task notes and comments at most 4,000 characters; at most 30 statuses. Task queries return at most 2,000 rows. Every module-off outcome is shown plainly.

The package and lockfile are the exact starter files. Migration and browser tools run directly with Node. The browser walk needs externally supplied Playwright test tooling; set `PROJECTS_BROWSER_TEST_MODULE` to its module entry file. No browser package is added to the app. `vitest.config.ts` runs only kit tests, sequentially.
