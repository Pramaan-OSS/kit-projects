# Team projects and tasks

An invite-only team workspace with projects, tasks, a board and list, personal task filters, project guest comments, attachments and CSV import/export.

Read KIT.md for routes, permissions, changes and checks. Use Node 24.18.0 and pnpm 11.15.1. Run `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`. Set `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, `PRAMAAN_PROJECT_ID` and `APP_ORIGIN=http://localhost:3440`. For local HTTP only set `APP_COOKIE_SECURE=false`. Run `node scripts/migrate.mjs`, `pnpm build`, then `pnpm start --port 3440`. The platform's signed owner pass opens `/owner`; use it to set owner sign-in details. People join by invite, with no public registration.

Email and attachments use the platform module socket. With modules off, invitations can be passed on through one-time links and unavailable actions explain why. Tests use fake modules, never live services. `node scripts/walk.mjs` runs headless on port 3440 against a disposable migrated database and starts/stops its own server.

MIT, Copyright (c) 2026 Sudo Sapient. Starter and block notices are in NOTICE.md; exact block pins are in blocks.lock.json.

The package and lockfile are the exact starter files. Migration and browser tools run directly with Node. The browser walk needs externally supplied Playwright test tooling; set `PROJECTS_BROWSER_TEST_MODULE` to its module entry file. No browser package is added to the app. `vitest.config.ts` runs only kit tests, sequentially.
