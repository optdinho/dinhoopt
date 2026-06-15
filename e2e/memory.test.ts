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

test('should navigate to Memory Optimizer page', async () => {
  await page.evaluate(() => { window.location.hash = '#/memory' })
  await page.waitForTimeout(1500)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('memory')
})

test('should render the Memory Optimizer page header', async () => {
  const hasTitle = await page.evaluate(() => {
    return document.body.textContent?.includes('Memory Optimizer')
  })
  expect(hasTitle).toBe(true)
})

test('should expose memory IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      info: typeof d?.memoryInfo,
      optimize: typeof d?.memoryOptimize,
      progress: typeof d?.onMemoryProgress,
    }
  })
  expect(handlers.info).toBe('function')
  expect(handlers.optimize).toBe('function')
  expect(handlers.progress).toBe('function')
})

test('should display memory usage section', async () => {
  const hasMemoryUsage = await page.evaluate(() => {
    return document.body.textContent?.includes('Memory Usage')
  })
  expect(hasMemoryUsage).toBe(true)
})

test('should display health score section', async () => {
  const hasHealthScore = await page.evaluate(() => {
    return document.body.textContent?.includes('Health Score')
  })
  expect(hasHealthScore).toBe(true)
})

test('should have an Optimize Memory button', async () => {
  const hasOptimize = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Optimize'))
  })
  expect(hasOptimize).toBe(true)
})

test('should have a Refresh button', async () => {
  const hasRefresh = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Refresh'))
  })
  expect(hasRefresh).toBe(true)
})

test('should display top processes section', async () => {
  const hasTopProcesses = await page.evaluate(() => {
    return document.body.textContent?.includes('Top Processes')
  })
  expect(hasTopProcesses).toBe(true)
})
