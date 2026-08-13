import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
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
  renameSync: (...args: unknown[]) => mocks.renameSync(...args),
  unlinkSync: (...args: unknown[]) => mocks.unlinkSync(...args),
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
    it('writes JSON to a temp file then renames over the target', () => {
      mocks.existsSync.mockReturnValue(false)
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      store.save({ items: ['x'], count: 1 })
      expect(mocks.mkdirSync).toHaveBeenCalled()
      const writeCall = mocks.writeFileSync.mock.calls[0]!
      expect(writeCall[0]).toContain('test.json.tmp')
      expect(writeCall[1]).toBe(JSON.stringify({ items: ['x'], count: 1 }, null, 2))
      expect(mocks.renameSync).toHaveBeenCalledTimes(1)
      const renameCall = mocks.renameSync.mock.calls[0]!
      expect(renameCall[0]).toContain('test.json.tmp')
      expect(renameCall[1]).toContain('test.json')
      expect(mocks.writeFileSync.mock.invocationCallOrder[0]!).toBeLessThan(
        mocks.renameSync.mock.invocationCallOrder[0]!,
      )
    })

    it('retries the write when it fails transiently', () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.writeFileSync.mockImplementationOnce(() => {
        throw new Error('EBUSY: file locked')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      expect(() => store.save({ items: ['x'], count: 1 })).not.toThrow()
      expect(mocks.writeFileSync).toHaveBeenCalledTimes(2)
      expect(mocks.renameSync).toHaveBeenCalledTimes(1)
    })

    it('retries the rename when it fails transiently', () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.renameSync.mockImplementationOnce(() => {
        throw new Error('EPERM: rename failed')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      expect(() => store.save({ items: ['x'], count: 1 })).not.toThrow()
      expect(mocks.renameSync).toHaveBeenCalledTimes(2)
    })

    it('throws after repeated write failures', () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.writeFileSync.mockImplementation(() => {
        throw new Error('EACCES: denied')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      expect(() => store.save({ items: ['x'], count: 1 })).toThrow('EACCES: denied')
      expect(mocks.writeFileSync).toHaveBeenCalledTimes(3)
    })

    it('throws after repeated rename failures', () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.renameSync.mockImplementation(() => {
        throw new Error('EPERM: rename failed')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      expect(() => store.save({ items: ['x'], count: 1 })).toThrow('EPERM: rename failed')
      expect(mocks.renameSync).toHaveBeenCalledTimes(3)
    })

    it('cleans up the temp file when a write attempt fails', () => {
      mocks.existsSync.mockReturnValue(false)
      mocks.writeFileSync.mockImplementationOnce(() => {
        throw new Error('EBUSY: file locked')
      })
      const store = createJsonStore<TestData>({ name: 'test.json', defaults: DEFAULTS })
      store.save({ items: ['x'], count: 1 })
      expect(mocks.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('test.json.tmp'))
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
