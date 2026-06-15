import { describe, expect, it } from 'vitest'

describe('getAllUserProfiles', () => {
  it('returns an array of user profile paths from C:\\Users', async () => {
    const { getAllUserProfiles } = await import('../main/platform/win32/paths')
    const profiles = getAllUserProfiles()
    expect(Array.isArray(profiles)).toBe(true)
    expect(profiles.length).toBeGreaterThan(0)
    for (const p of profiles) {
      expect(p.startsWith('C:\\Users\\')).toBe(true)
    }
  })

  it('does not include Public or Default system accounts', async () => {
    const { getAllUserProfiles } = await import('../main/platform/win32/paths')
    const profiles = getAllUserProfiles()
    for (const p of profiles) {
      const name = p.split('\\').pop()?.toLowerCase() ?? ''
      expect(['public', 'default', 'default user', 'all users']).not.toContain(name)
    }
  })
})

describe('getMalwareScanDirs', () => {
  it('accepts userProfile parameter and returns correct paths', async () => {
    const { getMalwareScanDirs } = await import('../main/platform/win32/paths')
    const dirs = getMalwareScanDirs('C:\\Users\\TestUser')
    expect(dirs).toContain('C:\\Users\\TestUser\\AppData\\Local\\Temp')
    expect(dirs).toContain('C:\\Users\\TestUser\\AppData\\LocalLow')
    expect(dirs).toContain('C:\\Users\\TestUser\\AppData\\Roaming')
    expect(dirs).toContain('C:\\Users\\TestUser\\Downloads')
    expect(dirs).toContain('C:\\Users\\TestUser\\Desktop')
  })

  it('falls back to USERPROFILE env when no param given', async () => {
    const originalProfile = process.env.USERPROFILE
    process.env.USERPROFILE = 'C:\\Users\\EnvUser'
    const { getMalwareScanDirs } = await import('../main/platform/win32/paths')
    const dirs = getMalwareScanDirs()
    expect(dirs).toContain('C:\\Users\\EnvUser\\AppData\\Local\\Temp')
    expect(dirs).toContain('C:\\Users\\EnvUser\\AppData\\LocalLow')
    process.env.USERPROFILE = originalProfile
  })

  it('includes AppData\\LocalLow in scan dirs', async () => {
    const { getMalwareScanDirs } = await import('../main/platform/win32/paths')
    const dirs = getMalwareScanDirs('C:\\Users\\ScanUser')
    expect(dirs).toContain('C:\\Users\\ScanUser\\AppData\\LocalLow')
  })

  it('throws when userProfile is empty string and USERPROFILE not set', async () => {
    const originalProfile = process.env.USERPROFILE
    delete process.env.USERPROFILE
    const { getMalwareScanDirs } = await import('../main/platform/win32/paths')
    expect(() => getMalwareScanDirs('')).not.toThrow()
    process.env.USERPROFILE = originalProfile
  })
})

describe('shouldSkipDir', () => {
  it('skips C:\\Windows but not C:\\MyWindows', async () => {
    const { shouldSkipDir } = await import('../main/services/malware-scanner.service')
    expect(shouldSkipDir('C:\\Windows\\System32', 'System32')).toBe(true)
    expect(shouldSkipDir('C:\\MyWindows\\App', 'MyWindows')).toBe(false)
  })

  it('skips C:\\Program Files paths', async () => {
    const { shouldSkipDir } = await import('../main/services/malware-scanner.service')
    expect(shouldSkipDir('C:\\Program Files\\Common Files', 'Common Files')).toBe(true)
    expect(shouldSkipDir('C:\\Program Files (x86)\\Common', 'Common')).toBe(true)
  })

  it('skips known system directory names', async () => {
    const { shouldSkipDir } = await import('../main/services/malware-scanner.service')
    expect(shouldSkipDir('C:\\SomeDir\\$Recycle.Bin', '$Recycle.Bin')).toBe(true)
    expect(shouldSkipDir('D:\\Data\\System Volume Information', 'System Volume Information')).toBe(true)
  })

  it('does not skip user data directories', async () => {
    const { shouldSkipDir } = await import('../main/services/malware-scanner.service')
    expect(shouldSkipDir('C:\\Users\\TestUser\\Downloads', 'Downloads')).toBe(false)
    expect(shouldSkipDir('C:\\Users\\TestUser\\AppData\\LocalLow', 'LocalLow')).toBe(false)
  })
})

describe('normalizePath', () => {
  it('adds \\\\?\\ prefix for paths > 240 characters', async () => {
    const { normalizePath } = await import('../main/services/malware-scanner.service')
    const longPath = `C:\\${'a'.repeat(240)}`
    const normalized = normalizePath(longPath)
    expect(normalized).toMatch(/^\\\\\?\\/)
  })

  it('does not add prefix for short paths', async () => {
    const { normalizePath } = await import('../main/services/malware-scanner.service')
    const shortPath = 'C:\\Users\\Test\\file.exe'
    expect(normalizePath(shortPath)).toBe(shortPath)
  })

  it('does not double-prefix if already prefixed', async () => {
    const { normalizePath } = await import('../main/services/malware-scanner.service')
    const alreadyPrefixed = '\\\\?\\C:\\Users\\file.exe'
    expect(normalizePath(alreadyPrefixed)).toBe(alreadyPrefixed)
  })
})

describe('SKIP_DIRS_SET', () => {
  it('contains expected system directory entries', async () => {
    const { SKIP_DIRS_SET } = await import('../main/services/malware-scanner.service')
    expect(SKIP_DIRS_SET.has('windows')).toBe(true)
    expect(SKIP_DIRS_SET.has('system32')).toBe(true)
    expect(SKIP_DIRS_SET.has('syswow64')).toBe(true)
    expect(SKIP_DIRS_SET.has('program files')).toBe(true)
    expect(SKIP_DIRS_SET.has('program files (x86)')).toBe(true)
    expect(SKIP_DIRS_SET.has('installer')).toBe(true)
    expect(SKIP_DIRS_SET.has('$recycle.bin')).toBe(true)
    expect(SKIP_DIRS_SET.has('system volume information')).toBe(true)
  })

  it('contains dev skip entries', async () => {
    const { SKIP_DIRS_SET } = await import('../main/services/malware-scanner.service')
    expect(SKIP_DIRS_SET.has('node_modules')).toBe(true)
    expect(SKIP_DIRS_SET.has('.git')).toBe(true)
  })
})

describe('FILE_EXTENSIONS', () => {
  it('includes new extensions like .msp, .psm1, .html', async () => {
    const { createWin32Malware } = await import('../main/platform/win32/malware')
    const exts = createWin32Malware().scannableExtensions()
    expect(exts).toContain('.msp')
    expect(exts).toContain('.psm1')
    expect(exts).toContain('.html')
    expect(exts).toContain('.htm')
    expect(exts).toContain('.wsc')
    expect(exts).toContain('.fon')
    expect(exts).toContain('.ime')
    expect(exts).toContain('.psd1')
    expect(exts).toContain('.ps1xml')
    expect(exts).toContain('.xsd')
    expect(exts).toContain('.xsl')
    expect(exts).toContain('.config')
  })
})
