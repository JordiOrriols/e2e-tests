# E2E Tests

## Local Access migration

`platform-local.config.ts` targets only the isolated local NestJS/PostgreSQL
stack; it does not use remote Supabase authentication or production projects.
Start the backend's local Compose stack with `compose.test.yml`, the `web`
profile, and its local signing fixture. Then run:

```sh
PLATFORM_DOCKER_WEB=1 npx playwright test --config=platform-local.config.ts
```

Planner and Shiplog use the same origin at `http://127.0.0.1:5320` under their
app paths. Tests cover default-deny identities, app/workspace grant boundaries,
revocation, private-field redaction and deep-route reloads. The Planner API uses
the real scheduler. Only test-owned platform identity/grant rows are removed.
Build the backend's `permissions` tools-profile image before running these
tests (`docker compose --env-file .env -f compose.local.yml build permissions`).
Browser scenarios grant and revoke their own test accounts through that
local administrator command, rather than modifying permissions with raw SQL.
Planner proposal coverage uses only a test-owned workspace/member/features:
real drag-and-drop, changed forecast dates, locked tasks, dependencies, named
snapshot persistence/restore/compare, same-email identity isolation,
cross-app grants, stale saves, revocation and unchanged official priorities.
The same scenario then verifies explicit editor confirmation/cancellation,
official priority persistence across reloads, preserved saved snapshots,
external/viewer write denial and stale/revoked official-write rejection.
Marker coverage reuses the real manager modal, verifies create/rename/delete,
identity/date preservation, invalid inputs and owner/editor versus viewer/
external access. All marker fixtures live only in test-owned local workspaces.
Project coverage reuses the existing manager modal for create/rename/delete,
checks persisted identity, invalid names, role denial and revocation, and
verifies that even off-roadmap backlog features disable deletion and cause
API 409 responses. Project fixtures are isolated and removed transactionally.
Task coverage reuses the real feature form to create a project/task, save
estimates and multiple-task dependencies, rename and change status, and reload
persisted private details. It checks rejected cycles/estimates, confirmation
cancellation, protected prerequisite deletion, viewer read-only controls,
external private-data denial, owner deletion and revocation. Delete assertions
wait for the actual API response, not a temporarily absent rendered card.
Do not run the historical default configs as migration tests: some authenticate
and seed against remote services even when the browser URL says localhost.

End-to-end testing repository for jordiorriols projects using Playwright.

## Projects Tested

| Project | Production URL | Localhost URL |
|---------|----------------|---------------|
| Website | https://www.jordiorriols.cat | http://localhost:5173 |
| Airmap | https://airmap.jordiorriols.cat | http://localhost:5174 |
| Ladders | https://ladders.jordiorriols.cat | http://localhost:5175 |
| Planner | Not configured | http://127.0.0.1:5176 |
| Shiplog | Not configured | http://127.0.0.1:5178 |

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

## Running Tests

### All Tests
```bash
npm test
```

### By Project
```bash
# Test a specific project (both localhost and production)
npm run test:website
npm run test:airmap
npm run test:ladders

# Planner currently has a localhost suite only
npm run test:planner
```

For an isolated Ladders server on a different port, set `LADDERS_LOCAL_URL`
before running tests, for example `LADDERS_LOCAL_URL=http://127.0.0.1:5185`.
The auth setup and collaboration contexts use this same URL.

Start Planner's development server first. Its live Supabase tests use
`LADDERS_TEST_EMAIL`, `LADDERS_TEST_PASSWORD`, `LADDERS_TEST2_EMAIL` and
`LADDERS_TEST2_PASSWORD` from the environment/keychain. The sibling Planner
environment supplies the shared Supabase URL and publishable key. Tests cover
estimate persistence, backlog priorities, concurrent roles, vacation-adjusted
dates, linked Ladders teams, anonymous member vacation links, viewer permissions
and intercepted recovery without
sending email. Planner also verifies integer-only estimates at the browser and
live database boundaries, direct backlog add/remove, localized shared header
controls, typography/icon sizes and mobile navigation. They create unique
workspaces and Ladders teams/members, and delete only their own test data.
Apply Planner's shared-team/vacation migration to the shared Supabase project
before running the updated tests; both apps must use the same project.

Start Shiplog's server on port 5178 and run
`npx playwright test --project=shiplog-localhost --workers=1`. This suite uses
the same account/environment helpers. It covers the Details/Changes/QA release
tabs, atomic detail/status saves, multiple same-workspace Planner feature links,
unlinking and reload persistence, Draft-only feature editing, name-only public
output, QA/approvals, workspace sharing and mobile modal controls. Apply Shiplog's
`20261031000000_shiplog_planner_features.sql` migration before running it.

### By Environment
```bash
# Test all projects on localhost
npm run test:localhost

# Test all projects on production
npm run test:production
```

### Visual Tests Only
```bash
# Run visual regression tests
npm run test:visual

# Update snapshots
npm run test:visual:update
```

### Interactive Mode
```bash
# Open Playwright UI
npm run test:ui

# Debug mode
npm run test:debug

# Headed mode (see the browser)
npm run test:headed
```

## Screenshot Comparison

Compare production vs localhost screenshots:

```bash
# Start your local dev servers first, then run:
npm run compare
```

This will:
1. Take screenshots of each page on production
2. Take screenshots of the same pages on localhost
3. Save them to `screenshots/comparison/` for manual comparison

## Project Structure

```
e2e-tests/
├── fixtures/           # Test fixtures and extensions
│   └── test-fixtures.ts
├── pages/              # Page Object Models
│   ├── base-page.ts
│   ├── common-components.ts
│   ├── website/
│   ├── airmap/
│   └── ladders/
├── utils/              # Shared utilities
│   ├── screenshots.ts
│   ├── wait-helpers.ts
│   ├── i18n-helpers.ts
│   └── a11y-helpers.ts
├── tests/              # Test files
│   ├── website/
│   ├── airmap/
│   ├── ladders/
│   └── planner/
├── scripts/            # CLI scripts
│   └── compare-screenshots.ts
└── playwright.config.ts
```

## Page Objects

Each project has its own page objects that extend `BasePage`:

```typescript
import { WebsiteHomePage } from "../../pages/website";

test("example", async ({ page }) => {
  const homePage = new WebsiteHomePage(page);
  await homePage.goto();
  await expect(homePage.heroSection).toBeVisible();
});
```

## Visual Testing

Visual tests are tagged with `@visual`:

```typescript
test("home page snapshot @visual", async ({ page, takeSnapshot }) => {
  await page.goto("/");
  await takeSnapshot("home-desktop");
});
```

## Test Tags

- `@visual` - Visual regression tests
- `@compare` - Production vs localhost comparison tests
- `@a11y` - Accessibility tests
- `@smoke` - Smoke tests

Run tests by tag:
```bash
npx playwright test --grep @visual
npx playwright test --grep @a11y
```

## Configuration

The `playwright.config.ts` defines projects for each app/environment combination:

- `website-localhost`
- `website-production`
- `airmap-localhost`
- `airmap-production`
- `ladders-localhost`
- `ladders-production`
- `planner-localhost`
- Mobile variants: `*-mobile`

## Reports

After running tests:
```bash
npm run report
```

## CI/CD Integration

Tests can be run in CI with:
```bash
CI=true npm test
```

This enables:
- GitHub Actions reporter
- Single worker execution
- Automatic retries on failure
