# E2E Tests

End-to-end testing repository for jordiorriols projects using Playwright.

## Projects Tested

| Project | Production URL | Localhost URL |
|---------|----------------|---------------|
| Website | https://www.jordiorriols.cat | http://localhost:5173 |
| Airmap | https://airmap.jordiorriols.cat | http://localhost:5174 |
| Ladders | https://ladders.jordiorriols.cat | http://localhost:5175 |

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
```

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
│   └── ladders/
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
