import { describe, expect, it } from 'vitest'
import { resolveWinapp2Path } from './resolve-winapp2-path'

describe('resolveWinapp2Path', () => {
  it('resolves known ${VAR} placeholders', () => {
    const result = resolveWinapp2Path('${LOCALAPPDATA}\\SomeApp')
    expect(result).toMatch(/^[A-Za-z]:\\/i)
    expect(result).toContain('SomeApp')
  })

  it('returns empty string segment for unknown ${VAR} placeholder', () => {
    const result = resolveWinapp2Path('${UNKNOWN_VAR}\\test')
    expect(result).toMatch(/\\test$/)
  })

  it('resolves known %VAR% placeholders', () => {
    const result = resolveWinapp2Path('%ProgramData%\\App')
    expect(result).toMatch(/^[A-Za-z]:\\/i)
    expect(result).toContain('App')
  })

  it('handles path without placeholders', () => {
    const result = resolveWinapp2Path('C:\\Some\\Path')
    expect(result).toMatch(/^[A-Za-z]:\\/i)
    expect(result).toContain('Some')
  })
})
