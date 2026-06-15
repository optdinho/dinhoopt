import { describe, expect, it } from 'vitest'
import { analyzeBehavior } from './behavioral-sandbox.service'

describe('BehavioralSandbox', () => {
  it('analyzeBehavior returns SandboxResult', () => {
    const result = analyzeBehavior('/test/clean.txt', Buffer.from('hello world'))
    expect(result).toHaveProperty('filePath')
    expect(result).toHaveProperty('riskScore')
    expect(result).toHaveProperty('behaviors')
    expect(result).toHaveProperty('isMalicious')
    expect(result).toHaveProperty('summary')
  })

  it('Detects registry autorun modification in script content', () => {
    const content = Buffer.from('Set-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"')
    const result = analyzeBehavior('/test/malicious.ps1', content)
    const reg = result.behaviors.find((b) => b.type === 'registry_write')
    expect(reg).toBeDefined()
    expect(reg!.severity).toBe('critical')
  })

  it('Detects self-replication pattern', () => {
    const content = Buffer.from('File.Copy("self.exe", "copy.exe")')
    const result = analyzeBehavior('/test/malware.ps1', content)
    const self = result.behaviors.find((b) => b.type === 'self_copy')
    expect(self).toBeDefined()
    expect(self!.severity).toBe('high')
  })

  it('Detects network connection pattern', () => {
    const content = Buffer.from('socket = new TcpClient("192.168.1.1", 4444)')
    const result = analyzeBehavior('/test/backdoor.ps1', content)
    const net = result.behaviors.find((b) => b.type === 'network_connect')
    expect(net).toBeDefined()
    expect(net!.severity).toBe('critical')
  })

  it('Detects process creation pattern', () => {
    const content = Buffer.from('Process.Start("cmd.exe", "/c dir")')
    const result = analyzeBehavior('/test/runner.ps1', content)
    const proc = result.behaviors.find((b) => b.type === 'process_create')
    expect(proc).toBeDefined()
    expect(proc!.severity).toBe('high')
  })

  it('Detects DLL injection pattern', () => {
    const content = Buffer.from('LoadLibrary("evil.dll") && CreateRemoteThread')
    const result = analyzeBehavior('/test/injector.ps1', content)
    const dll = result.behaviors.find((b) => b.type === 'dll_inject')
    expect(dll).toBeDefined()
    expect(dll!.severity).toBe('critical')
  })

  it('Detects persistence mechanism', () => {
    const content = Buffer.from('schtasks /create /tn "Updater" /tr "evil.exe"')
    const result = analyzeBehavior('/test/persist.ps1', content)
    const persist = result.behaviors.find((b) => b.type === 'persistence_install')
    expect(persist).toBeDefined()
    expect(persist!.severity).toBe('high')
  })

  it('Detects anti-debug patterns', () => {
    const content = Buffer.from('if (IsDebuggerPresent) { exit }')
    const result = analyzeBehavior('/test/anti.ps1', content)
    const anti = result.behaviors.find((b) => b.type === 'anti_debug')
    expect(anti).toBeDefined()
    expect(anti!.severity).toBe('medium')
  })

  it('Detects file write to system dir', () => {
    const content = Buffer.from('WriteFile("C:\\Windows\\System32\\evil.dll")')
    const result = analyzeBehavior('/test/dropper.ps1', content)
    const fw = result.behaviors.find((b) => b.type === 'file_write')
    expect(fw).toBeDefined()
    expect(fw!.severity).toBe('high')
  })

  it('Clean file returns 0 behaviors', () => {
    const content = Buffer.from('This is a completely harmless text file with no suspicious patterns whatsoever.')
    const result = analyzeBehavior('/test/clean.txt', content)
    expect(result.behaviors).toHaveLength(0)
    expect(result.riskScore).toBe(0)
  })

  it('Risk score calculation: critical = 25, high = 15, medium = 5', () => {
    const content = Buffer.from('IsDebuggerPresent && schtasks /create && 192.168.1.1 socket')
    const result = analyzeBehavior('/test/scored.ps1', content)
    const criticalBehaviors = result.behaviors.filter((b) => b.severity === 'critical')
    const highBehaviors = result.behaviors.filter((b) => b.severity === 'high')
    const mediumBehaviors = result.behaviors.filter((b) => b.severity === 'medium')
    const expectedScore = criticalBehaviors.length * 25 + highBehaviors.length * 15 + mediumBehaviors.length * 5
    expect(result.riskScore).toBe(expectedScore)
  })

  it('isMalicious true when score >= 25', () => {
    const content = Buffer.from('LoadLibrary("x") && CreateRemoteThread && CurrentVersion\\Run')
    const result = analyzeBehavior('/test/mal.ps1', content)
    expect(result.isMalicious).toBe(true)
  })

  it('isMalicious false for clean files', () => {
    const result = analyzeBehavior('/test/clean.txt', Buffer.from('hello world'))
    expect(result.isMalicious).toBe(false)
  })

  it('isPE detection from MZ header', () => {
    const mzBuffer = Buffer.alloc(100)
    mzBuffer[0] = 0x4d
    mzBuffer[1] = 0x5a
    const result = analyzeBehavior('/test/file.exe', mzBuffer)
    const fileInfo = (result as unknown as { fileInfo?: { isPE: boolean } }).fileInfo || { isPE: false }
    expect(fileInfo.isPE).toBe(true)
  })

  it('isScript detection from extension', () => {
    const content = Buffer.from('Write-Host "test"')
    const result = analyzeBehavior('/test/file.ps1', content)
    const fileInfo = (result as unknown as { fileInfo?: { isScript: boolean } }).fileInfo || { isScript: false }
    expect(fileInfo.isScript).toBe(true)
  })

  it('isOffice detection from extension', () => {
    const content = Buffer.from('macro')
    const result = analyzeBehavior('/test/file.docm', content)
    const fileInfo = (result as unknown as { fileInfo?: { isOffice: boolean } }).fileInfo || { isOffice: false }
    expect(fileInfo.isOffice).toBe(true)
  })

  it('Multiple behaviors all reported', () => {
    const content = Buffer.from(
      'LoadLibrary("evil") && CreateRemoteThread && socket("192.168.1.1") && Process.Start("cmd")',
    )
    const result = analyzeBehavior('/test/multi.ps1', content)
    expect(result.behaviors.length).toBeGreaterThanOrEqual(3)
  })

  it('Edge case: empty buffer', () => {
    const result = analyzeBehavior('/test/empty.bin', Buffer.alloc(0))
    expect(result.behaviors).toHaveLength(0)
    expect(result.riskScore).toBe(0)
    expect(result.isMalicious).toBe(false)
  })

  it('Edge case: very large file', () => {
    const largeContent = Buffer.alloc(10 * 1024 * 1024)
    largeContent.fill('A')
    const result = analyzeBehavior('/test/large.bin', largeContent)
    expect(result.behaviors).toHaveLength(0)
    expect(result.riskScore).toBe(0)
  })

  it('Edge case: null bytes in content (no crash)', () => {
    const content = Buffer.from([0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f])
    const result = analyzeBehavior('/test/null.bin', content)
    expect(result).toBeDefined()
    expect(result.filePath).toBe('/test/null.bin')
  })

  it('Summary indicates malicious/suspect/clean correctly', () => {
    const cleanResult = analyzeBehavior('/test/clean.txt', Buffer.from('hello'))
    expect(cleanResult.summary).toContain('Limpo')

    const malContent = Buffer.from('LoadLibrary("x") && CreateRemoteThread && CurrentVersion\\Run')
    const malResult = analyzeBehavior('/test/mal.exe', malContent)
    expect(malResult.summary).toContain('MALICIOSO')

    const susContent = Buffer.from('IsDebuggerPresent')
    const susResult = analyzeBehavior('/test/sus.exe', susContent)
    expect(susResult.summary).toContain('Suspeito')
  })
})
