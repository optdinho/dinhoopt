import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { resolve } from 'path'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp.close()
})

test('should navigate to Compliance page', async () => {
  await page.evaluate(() => { window.location.hash = '#/compliance' })
  await page.waitForTimeout(1500)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('compliance')
})

test('should render the Compliance Auditor page header', async () => {
  const hasTitle = await page.evaluate(() => {
    return document.body.textContent?.includes('Compliance Auditor')
  })
  expect(hasTitle).toBe(true)
})

test('should expose compliance IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      scan: typeof d?.complianceScan,
      apply: typeof d?.complianceApply,
      revert: typeof d?.complianceRevert,
      progress: typeof d?.onComplianceProgress,
    }
  })
  expect(handlers.scan).toBe('function')
  expect(handlers.apply).toBe('function')
  expect(handlers.revert).toBe('function')
  expect(handlers.progress).toBe('function')
})

test('should have an Audit button', async () => {
  const hasAuditButton = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Audit'))
  })
  expect(hasAuditButton).toBe(true)
})

test('should render category sections after scan', async () => {
  const categories = ['Password Policy', 'Audit & Logging', 'Network Security', 'Windows Update', 'BitLocker', 'Firewall', 'User Account Control']
  for (const cat of categories) {
    const found = await page.evaluate((c) => {
      return document.body.textContent?.includes(c)
    }, cat)
    expect(found).toBe(true)
  }
})

test('should show compliance score section', async () => {
  const hasScore = await page.evaluate(() => {
    return document.body.textContent?.includes('Compliance Score')
  })
  expect(hasScore).toBe(true)
})

test('should display Compliant and Non-Compliant counts', async () => {
  const hasCounts = await page.evaluate(() => {
    return document.body.textContent?.includes('Compliant')
      && document.body.textContent?.includes('Non-Compliant')
  })
  expect(hasCounts).toBe(true)
})
