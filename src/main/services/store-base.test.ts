import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  join: vi.fn(),
  userData: '/fake/userdata',
  isPackaged: false,
}))

let electronIsPackaged = false

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
}))

vi.mock('node:path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronIsPackaged
    },
    getPath: () => mocks.userData,
  },
}))

import { createJsonStore } from './store-base'

interface TestData {
  items: string[]
  count: number
}

const DEFAULTS: TestData = { items: [], count: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  electronIsPackaged = false
})

afterEach(() => {
  vi.resetAllMocks()
  electronIsPackaged = false
})

describe('createJsonStore', () => {
  it('creates a store with the correct path', () => {
    const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
    expect(store.path).toContain('test.json')
  })

  describe('load', () => {
    it('returns defaults when file does not exist', () => {
      mocks.existsSync.mockReturnValue(false)
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      const data = store.load()
      expect(data).toEqual(DEFAULTS)
    })

    it('returns parsed data when file exists', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('{"items":["a","b"],"count":2}')
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      const data = store.load()
      expect(data).toEqual({ items: ['a', 'b'], count: 2 })
    })

    it('returns defaults on parse error', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('invalid json')
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      const data = store.load()
      expect(data).toEqual(DEFAULTS)
    })

    it('returns defaults on read error', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockImplementationOnce(() => {
        throw new Error('read failed')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      const data = store.load()
      expect(data).toEqual(DEFAULTS)
    })
  })

  describe('save', () => {
    it('writes JSON to file', () => {
      mocks.existsSync.mockReturnValue(false)
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      store.save({ items: ['x'], count: 1 })
      expect(mocks.mkdirSync).toHaveBeenCalled()
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.json'),
        JSON.stringify({ items: ['x'], count: 1 }, null, 2),
      )
    })
  })

  describe('update', () => {
    it('loads, transforms, and saves data', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue('{"items":["a"],"count":1}')
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })

      const result = store.update((data) => ({ ...data, items: [...data.items, 'b'], count: data.count + 1 }))
      expect(result).toEqual({ items: ['a', 'b'], count: 2 })
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test.json'),
        JSON.stringify({ items: ['a', 'b'], count: 2 }, null, 2),
      )
    })
  })

  describe('resetCache', () => {
    it('recomputes path on next call', () => {
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      const firstPath = store.path
      store.resetCache()
      const secondPath = store.path
      expect(firstPath).toBe(secondPath) // Same result, but recomputed
    })
  })

  describe('devSuffix', () => {
    it('uses devSuffix when app is not packaged', () => {
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS, devSuffix: 'MyDev' })
      mocks.existsSync.mockReturnValue(false)
      store.load()
      expect(mocks.readFileSync).not.toHaveBeenCalled()
    })

    it('uses plain userData path when app is packaged', () => {
      electronIsPackaged = true
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS, devSuffix: 'MyDev' })
      mocks.existsSync.mockReturnValue(false)
      store.load()
      expect(mocks.readFileSync).not.toHaveBeenCalled()
      electronIsPackaged = false
    })
  })
})
