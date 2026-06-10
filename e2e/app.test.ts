import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { resolve } from 'path'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  })
  page = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp.close()
})

test('should display the app window', async () => {
  const title = await page.title()
  expect(title).toBeTruthy()
})

test('should expose kudu API in the renderer', async () => {
  const hasKudu = await page.evaluate(() => typeof window.kudu !== 'undefined')
  expect(hasKudu).toBe(true)
})

test('should navigate to Activation page', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/activation'
  })
  await page.waitForTimeout(1000)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('activation')
})
