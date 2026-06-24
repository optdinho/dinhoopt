import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface GameEntry {
  processName: string
  windowClass: string
  displayName: string
  aliases: string[]
  backends: string[]
}

interface GameDatabase {
  version: number
  games: GameEntry[]
}

function findGamesJsonPath(): string {
  const candidates = [
    resolve(__dirname, '..', '..', 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'games.json'),
    resolve(process.cwd(), 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'games.json'),
    resolve(__dirname, '..', '..', '..', 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'games.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `games.json not found at any candidate path:\n${candidates.map((c) => `  - ${c}`).join('\n')}`
  )
}

function loadGamesDatabase(): GameDatabase {
  const path = findGamesJsonPath()
  const raw = readFileSync(path, 'utf-8')
  const db: GameDatabase = JSON.parse(raw)
  return db
}

describe('games.json', () => {
  let db: GameDatabase

  beforeAll(() => {
    db = loadGamesDatabase()
  })

  it('parses as valid JSON', () => {
    expect(db).toBeDefined()
    expect(typeof db.version).toBe('number')
    expect(Array.isArray(db.games)).toBe(true)
  })

  it('has version >= 1', () => {
    expect(db.version).toBeGreaterThanOrEqual(1)
  })

  it('contains at least 30 games', () => {
    expect(db.games.length).toBeGreaterThanOrEqual(30)
  })

  it('has no duplicate processNames', () => {
    const names = db.games.map((g) => g.processName.toLowerCase())
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
    expect(duplicates).toEqual([])
  })

  it('has no duplicate displayNames', () => {
    const names = db.games.map((g) => g.displayName.toLowerCase())
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
    expect(duplicates).toEqual([])
  })

  it('has no alias collisions with processNames of other games', () => {
    const processNameMap = new Map(db.games.map((g) => [g.processName.toLowerCase(), g.displayName]))
    const conflicts: string[] = []
    for (const game of db.games) {
      for (const alias of game.aliases) {
        const key = alias.toLowerCase()
        if (processNameMap.has(key) && processNameMap.get(key) !== game.displayName) {
          conflicts.push(
            `Alias "${alias}" of "${game.displayName}" collides with processName of "${processNameMap.get(key)}"`
          )
        }
      }
    }
    expect(conflicts).toEqual([])
  })

  it('has no alias collisions with other aliases', () => {
    const aliasMap = new Map<string, string>()
    const conflicts: string[] = []
    for (const game of db.games) {
      for (const alias of game.aliases) {
        const key = alias.toLowerCase()
        if (aliasMap.has(key)) {
          conflicts.push(
            `Alias "${alias}" is used by both "${aliasMap.get(key)}" and "${game.displayName}"`
          )
        } else {
          aliasMap.set(key, game.displayName)
        }
      }
    }
    expect(conflicts).toEqual([])
  })

  it('every game has required fields', () => {
    for (const game of db.games) {
      expect(game).toHaveProperty('processName')
      expect(game).toHaveProperty('windowClass')
      expect(game).toHaveProperty('displayName')
      expect(game).toHaveProperty('aliases')
      expect(game).toHaveProperty('backends')
    }
  })

  it('every game has non-empty processName', () => {
    const empty = db.games.filter((g) => !g.processName || g.processName.trim() === '')
    expect(empty).toEqual([])
  })

  it('every game has non-empty displayName', () => {
    const empty = db.games.filter((g) => !g.displayName || g.displayName.trim() === '')
    expect(empty).toEqual([])
  })

  it('every game has aliases array', () => {
    const noAliases = db.games.filter((g) => !Array.isArray(g.aliases))
    expect(noAliases).toEqual([])
  })

  it('every game has backends array', () => {
    const noBackends = db.games.filter((g) => !Array.isArray(g.backends))
    expect(noBackends).toEqual([])
  })

  it('every game has at least one alias', () => {
    const emptyAliases = db.games.filter((g) => g.aliases.length === 0)
    expect(emptyAliases).toEqual([])
  })

  it('all backends are valid values', () => {
    const validBackends = new Set(['wgc', 'dxgi', 'hybrid'])
    const invalid: string[] = []
    for (const game of db.games) {
      for (const backend of game.backends) {
        if (!validBackends.has(backend)) {
          invalid.push(`${game.displayName}: invalid backend "${backend}"`)
        }
      }
    }
    expect(invalid).toEqual([])
  })

  it('processNames and aliases do not contain path traversal characters', () => {
    const dangerous = /[/\\:<>"|?*]/
    const issues: string[] = []
    for (const game of db.games) {
      if (dangerous.test(game.processName)) {
        issues.push(`processName "${game.processName}" has dangerous chars`)
      }
      for (const alias of game.aliases) {
        if (dangerous.test(alias)) {
          issues.push(`Alias "${alias}" in "${game.displayName}" has dangerous chars`)
        }
      }
    }
    expect(issues).toEqual([])
  })

  it('all windowClasses are non-empty strings', () => {
    const empty = db.games.filter(
      (g) => typeof g.windowClass !== 'string' || g.windowClass.trim() === ''
    )
    expect(empty).toEqual([])
  })

  it('each game can be identified by at least one property', () => {
    for (const game of db.games) {
      const hasUsableIdentifier =
        game.processName.trim() !== '' || game.windowClass.trim() !== ''
      expect(hasUsableIdentifier).toBe(true)
    }
  })

  it('has processName entries matching common Windows exe patterns', () => {
    const allMatch = db.games.every(
      (g) => !g.processName.includes('.exe')
    )
    expect(allMatch).toBe(true)
  })

  it('no duplicate (processName, windowClass) pairs', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const game of db.games) {
      const key = `${game.processName.toLowerCase()}|${game.windowClass.toLowerCase()}`
      if (seen.has(key)) {
        dupes.push(key)
      }
      seen.add(key)
    }
    expect(dupes).toEqual([])
  })
})
