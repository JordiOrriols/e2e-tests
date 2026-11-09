# E2E Tests

## Local Access migration

`platform-local.config.ts` targets only the isolated local NestJS/PostgreSQL
stack; it does not use remote Supabase authentication or production projects.
Start the backend's local Compose stack with `compose.test.yml`, the `web`
profile, and its local signing fixture. Then run:

```sh
PLATFORM_DOCKER_WEB=1 npx playwright test --config=platform-local.config.ts
```

Planner, Shiplog and Ladders use the same origin at `http://127.0.0.1:5320` under their
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
Calendar coverage navigates from the real roadmap, saves a vacation range,
reloads its indicators, restores one working day, saves decimal sprint points
and reloads calibration. It checks exact input/date boundaries, cross-workspace
member isolation, roster redaction, viewer/external denial and revocation.
All calendar members, teams and vacations are test-owned; no personal vacation
link or remote service is used.
The same scenario navigates to team configuration, creates a team as owner,
changes a planning role and reloads it, clears that role as editor and verifies
the vacation view excludes the unassigned member from capacity. Editors cannot
create teams; viewers cannot change roles; cross-workspace/invalid roles are
rejected and no vacation-copy button is exposed.
Navigation coverage separates estimation from the official roadmap, checks
that roadmap loads no private feature/project directory, reloads estimation,
switches between internal/external-granted workspaces, denies external internal
views, and verifies workspace-list navigation plus unknown-route handling.
Task/project editing runs on estimation; inclusion tests navigate back to the
roadmap for start dates and verify that both views share persisted API state.
Shiplog application coverage uses the existing modal to create and rename an
application, assign/clear its team, reload persisted identity and confirm empty
deletion. It verifies invalid fields, cross-workspace IDs, viewer/external/
revoked denial, release-protected deletion and platform-owned audit records.
Fixtures are isolated, including audit events; production data is untouched.
Shiplog release coverage uses the shared form to stage feature links without
writing, create and reload a draft, save unlinking with a QA status change, then
update notes/status with locked version/title fields. It checks stable identity/
creation time, platform-owned audits, duplicate/invalid versions, foreign feature
rejection, viewer inspection without saving and external catalog-only access.
Checklist coverage uses the existing template editor and QA modal. It verifies
owner-only template editing, future-only snapshots, stale-save errors and reload,
check completion/reload/clearing, platform actor storage without modifying legacy
completion, viewer read-only QA, external denial and unchanged manual release status.
Approval coverage uses the existing thumbs controls, reloads decisions and checks
independent same-email subjects. Viewer self-decisions do not confer editing
rights, submitted user IDs cannot impersonate another actor, foreign releases and
external writes are denied, and revoked participants disappear without removing
stored decisions. Imported legacy approvals and manual status remain unchanged.
Audit coverage navigates from the directory, loads 50 then 2 mixed-source events,
checks expandable details and unmapped legacy actors, stable nonduplicate cursors,
reload, malformed/foreign cursor errors and external/revoked denial.
Ladders coverage opens the authenticated workspace/team directory, reuses the
shared name alert dialog for create/rename and reloads persisted results. It
checks profile-only field shapes, owner/editor/viewer boundaries, cross-app
grant isolation, invalid/foreign writes, revocation, hash-free deep links and
removal of anonymous evaluation/password routes from the runtime. All fixture
members/teams/workspaces are local and removed; legacy identity linking is never
inferred from email.
Ladders profile coverage reuses the assessment's profile fields, planning-role
selector and seniority template picker, saves/reloads and verifies immutable
legacy tokens, account/owner IDs, creation dates and evaluation history. It checks
editor saving, viewer read-only fields, foreign/missing member rejection, invalid
inputs and visible save errors after revocation. Planning-role changes update the
Planner roster only under its separate app grant.
Ladders deletion coverage checks owner-only controls/API, cancellation before any
write, member-record cascades, disabled nonempty teams, visible default-team and
revoked-delete errors, foreign-target rejection and persistence after deletion.
The workspace and grants remain, with legacy automatic-container cleanup disabled
transactionally. Database integration also verifies surviving member/account/history
records and Shiplog application retention when its team association clears.
Ladders creation coverage uses the shared profile form from a team link, verifies
ID-only response, persistent member-route replacement and directory reload,
unlinked legacy account and owner storage metadata, viewer/foreign denial and
visible revoked-save failures with no partial member. Database integration also
tests direct runtime INSERT denial, retained legacy insert authorization and
atomic rollback of invalid profiles.
Ladders move coverage selects a destination using UI's shared team selector,
checks no write before explicit save, reloads the persistent association and
verifies profile/tokens/history retention and directory placement. It checks
viewer/foreign/invalid/revoked moves and visible errors without changing teams.
Database integration additionally verifies preserved linked accounts, goals,
evaluations, invitations and vacations; linked-account conflicts roll back,
same-team calls are idempotent and legacy owner/unauthenticated checks remain.
Ladders evaluation-history coverage follows the profile's Versions link, reuses
version selection/comparisons, reloads a hash-free deep link and checks the
language selector/footer and profile navigation. It verifies manager/peer and
published self history, excludes private self drafts from both API and DOM,
keeps status/deletion controls disabled, rejects foreign/invalid/revoked access
and preserves every imported evaluation field. Database integration additionally
checks all internal roles, same-email identity isolation, cross-app denial and
direct runtime SELECT denial; internal hidden comments remain reviewer-visible.
Ladders visibility coverage reuses the legacy assessment panel to share/hide
manager, published-self and peer comments, reloads persisted settings and verifies
independent categories. Viewers have no controls; revoked/malformed/missing-comment/
wrong-member/private-self-draft writes fail without changing history content,
status or timestamps. Database integration verifies legacy employee server-side
redaction, default-hidden peer notes and draft-peer approval without publication.
Ladders editing coverage uses the existing competency form and queued autosave
hook, persists one manager draft, edits it in place and publishes the same ID.
It verifies copied hidden-comment metadata, immutable published history,
viewer read-only mode, independent peer publication, employee-owned self status
and explicit revoked-autosave errors without a partial version. Database
integration also checks duplicate-draft conflicts, foreign/invalid targets,
creation-date/visibility retention and runtime direct INSERT/UPDATE denial.
Ladders evaluation deletion coverage reuses the owner-only version-panel
confirmation, checks cancel/no-write, editor/viewer/revoked/foreign rejection,
and removes manager, peer and published self versions. It deletes a dirty
manager draft only after its queued autosave settles; private self drafts remain
unlisted and undeletable. Database integration checks scoped locks, direct
runtime DELETE denial and the same private-self boundary.
SMART goal coverage reuses the member profile panel and verifies viewer
read-only access, editor creation/editing/progress/comments, owner-only deletion,
revocation and scoped API permissions. Database integration checks preserved
legacy comments, append-only manager comments, foreign-goal rejection and direct
runtime table denial.
Legacy account mapping coverage provisions an exact verified/legacy UUID pair
through the local administrator tool, rejects a competing same-email subject,
and proves mapping alone grants no workspace access. Explicit grants remain
separate; unmapping leaves them intact and imported owner IDs do not change.
All 29 isolated migration scenarios pass with one worker and zero retries.
Task coverage reuses the real feature form to create a project/task, save
estimates and multiple-task dependencies, rename and change status, and reload
persisted private details. It checks rejected cycles/estimates, confirmation
cancellation, protected prerequisite deletion, viewer read-only controls,
external private-data denial, owner deletion and revocation. Delete assertions
wait for the actual API response, not a temporarily absent rendered card.
Roadmap settings coverage verifies prerequisite-first inclusion in the reused
modal, blocked prerequisite removal, persisted start dates, rejected impossible/
unverified dates, unchanged task fields and viewer/revoked write denial.
Do not run the historical default configs as migration tests: some authenticate
and seed against remote services even when the browser URL says localhost.

## Shared account and public-link layouts

`tests/ui/account-public-layout.spec.ts` checks shared account/login error
localization and recovery, signup confirmation, password reset, OAuth failures,
public-frame mobile language controls, restricted-write callbacks, one
header/main/footer, and exact short/long footer geometry. Storybook callbacks
are local examples; these tests never authenticate against a production account.

With the UI built Storybook preview on port 6008:

```sh
npx playwright test tests/ui/account-public-layout.spec.ts --project=ui-localhost --workers=1
```

## Shared app-shell composition

`tests/ui/app-shell.spec.ts` validates the built UI AppShell Storybook examples.
It covers desktop/mobile navigation, keyboard language selection, localized
contribution links, caller-owned account actions, short-page footer placement,
long-page document scrolling, and full-width main overrides.
Start the UI built Storybook preview on port 6008, then run:

```sh
npx playwright test tests/ui/app-shell.spec.ts --project=ui-localhost --workers=1
```

End-to-end testing repository for jordiorriols projects using Playwright.

## Projects Tested

| Project      | Production URL                   | Localhost URL         |
| ------------ | -------------------------------- | --------------------- |
| Website      | https://www.jordiorriols.cat     | http://localhost:5173 |
| Airmap       | https://airmap.jordiorriols.cat  | http://localhost:5174 |
| Ladders      | https://ladders.jordiorriols.cat | http://localhost:5175 |
| Planner      | Not configured                   | http://127.0.0.1:5176 |
| Shiplog      | Not configured                   | http://127.0.0.1:5178 |
| UI Storybook | Not configured                   | http://127.0.0.1:6008 |

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

## Running Tests

### Shared UI forms

Serve the UI repository's built Storybook on port 6008 (or set `UI_LOCAL_URL`),
then run `npx playwright test form-fields.spec.ts --project=ui-localhost`.
The suite verifies shared field labels, hint/error associations, native form
validation, submitted values, reset, disabled controls and desktop/mobile sizing.
The existing global auth setup still requires the standard test-account environment.

Shared error boundaries/states are covered by
`npx playwright test error-states.spec.ts --project=ui-localhost` against the
same built UI Storybook. The suite verifies diagnostics, explicit keyboard
recovery, disabled retry and desktop/mobile fallback readability.

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
