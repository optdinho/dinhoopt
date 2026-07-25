---
name: e2e-runner
description: Use this skill for generating, maintaining, and running Playwright E2E tests. Manages test journeys for Electron app (main process + renderer), handles flaky tests, captures artifacts. Adapted for DiNho Optimizer.
origin: ECC
---

# E2E Test Runner

Expert end-to-end testing specialist for DiNho Optimizer's Electron app using Playwright.

## When to Activate

- Generating new E2E tests for critical user flows
- Debugging flaky E2E tests
- Running E2E test suite
- Setting up new test journeys
- After UI changes that may break E2E tests

## Project Context

DiNho Optimizer is an **Electron app** (not a web app). E2E tests run against the packaged Electron binary using `@playwright/test` with Electron launcher.

### Existing E2E Structure
```
tests/e2e/
├── app.spec.ts              # App launch, window checks
├── malware-scanner.spec.ts  # Malware scanning flow
├── vulnerability.spec.ts    # Vulnerability scanner flow
├── privacy-shield.spec.ts   # Privacy shield flow
├── clips.spec.ts            # Game clips capture flow
├── windows-tweaks.spec.ts   # Windows tweaks flow
├── license.spec.ts          # License verification flow
└── fixtures/
    └── electron.ts          # Electron app launcher fixture
```

## Core Commands

```bash
# Run all E2E tests
npx playwright test tests/e2e/

# Run specific test file
npx playwright test tests/e2e/malware-scanner.spec.ts

# Run headed (see the app)
npx playwright test --headed

# Debug with inspector
npx playwright test --debug

# Run with trace
npx playwright test --trace on

# Show HTML report
npx playwright show-report

# Update snapshots
npx playwright test --update-snapshots
```

## E2E Testing Workflow

### 1. Test Planning

Identify critical user journeys:
- **App startup** — window loads, sidebar renders, navigation works
- **Malware scan** — start scan → results → actions
- **Vulnerability scan** — start scan → score → findings
- **Clips capture** — start engine → status → save clip
- **Settings** — change settings → persist → restart loads correctly
- **License** — activate → validate → features unlock

### 2. Test Structure (Electron-specific)

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

test.describe('Feature Name', () => {
  let electronApp: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DINHO_E2E: '1',
      },
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('should do something', async () => {
    // Navigate
    await page.click('[data-testid="nav-item-malware"]')

    // Interact
    await page.click('[data-testid="start-scan-button"]')

    // Assert
    await expect(page.locator('text=Scan complete')).toBeVisible({
      timeout: 60000,
    })
  })
})
```

### 3. Best Practices for Electron E2E

**Use data-testid selectors:**
```typescript
// ✅ GOOD — stable selector
await page.click('[data-testid="start-scan-button"]')

// ❌ BAD — fragile selector
await page.click('.sc-abc123 >> text=Start')
```

**Wait for IPC responses:**
```typescript
// ✅ GOOD — wait for actual data
await page.waitForFunction(() => {
  return window.__someState !== undefined
})

// ❌ BAD — arbitrary timeout
await page.waitForTimeout(5000)
```

**Handle long-running operations:**
```typescript
// Scans can take 60+ seconds
test('malware scan completes', async () => {
  await page.click('[data-testid="start-scan-button"]')

  // Wait for scan to actually finish
  await expect(page.locator('[data-testid="scan-status"]')).toHaveText(
    'Complete',
    { timeout: 120000 }
  )
})
```

**Use E2E hooks for backend operations:**
```typescript
// Expose callbacks via window for test control
// In renderer: window.__runScan = runScanCallback
// In test: await page.evaluate(() => window.__runScan())
```

### 4. Flaky Test Management

**Common causes in Electron E2E:**
- Named pipe connection delays (clips engine)
- IPC response timing
- Window focus/state changes
- Long-running scan operations

**Quarantine pattern:**
```typescript
test('flaky: complex scenario', async ({ page }) => {
  test.fixme(true, 'Flaky — Issue #123')
  // ...
})

// Or skip in CI
test('slow scan', async ({ page }) => {
  test.skip(!!process.env.CI, 'Too slow for CI')
  // ...
})
```

**Fix flakiness:**
```typescript
// ❌ FLAKY: assumes element ready
await page.click('button')

// ✅ STABLE: wait for specific state
await page.locator('[data-testid="button"]').waitFor({ state: 'visible' })
await page.click('[data-testid="button"]')

// ✅ STABLE: wait for IPC response
await page.waitForResponse(
  (resp) => resp.url().includes('ipc') && resp.status() === 200
)
```

### 5. Artifact Collection

**Screenshots on failure:**
```typescript
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({
      path: `test-results/${testInfo.title}-failure.png`,
    })
  }
})
```

**Trace for debugging:**
```bash
npx playwright test --trace on
npx playwright show-trace
```

## Critical Test Scenarios for DiNho

### 1. App Startup
```typescript
test('app launches and shows dashboard', async () => {
  await expect(page.locator('text=DiNho Optimizer')).toBeVisible()
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
  await expect(page.locator('[data-testid="nav-item-dashboard"]')).toBeVisible()
})
```

### 2. Malware Scan Flow
```typescript
test('malware scan completes with results', async () => {
  await page.click('[data-testid="nav-item-malware"]')
  await page.click('[data-testid="start-scan-button"]')

  await expect(page.locator('[data-testid="scan-progress"]')).toBeVisible()
  await expect(page.locator('text=Scan complete')).toBeVisible({
    timeout: 120000,
  })

  const results = page.locator('[data-testid="scan-result-item"]')
  await expect(results.first()).toBeVisible()
})
```

### 3. Clips Engine Lifecycle
```typescript
test('clips engine starts and shows status', async () => {
  await page.click('[data-testid="nav-item-clips"]')

  // Wait for engine to connect
  await expect(page.locator('[data-testid="engine-status"]')).toHaveText(
    /running|connected/i,
    { timeout: 30000 }
  )
})
```

### 4. Settings Persistence
```typescript
test('settings persist across restart', async () => {
  // Change a setting
  await page.click('[data-testid="nav-item-settings"]')
  await page.click('[data-testid="toggle-game-mode"]')

  // Restart app
  await electronApp.close()
  electronApp = await electron.launch({ args: ['.'], env: { DINHO_E2E: '1' } })
  page = await electronApp.firstWindow()

  // Verify setting persisted
  await page.click('[data-testid="nav-item-settings"]')
  await expect(page.locator('[data-testid="toggle-game-mode"]')).toBeChecked()
})
```

## CI Integration

```yaml
# GitHub Actions example
- name: Run E2E tests
  run: npx playwright test tests/e2e/
  env:
    DINHO_E2E: '1'

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 30
```

## Success Metrics

After E2E run:
- [ ] All critical journeys passing (100%)
- [ ] Pass rate > 95% overall
- [ ] Flaky rate < 5%
- [ ] Test duration < 5 minutes
- [ ] Artifacts captured on failure
- [ ] HTML report generated
