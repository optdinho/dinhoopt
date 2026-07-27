import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { RegistryEntry } from '@shared/types'
import { clsidExists, execReg, extractExePath, findMissingClsidDll } from './utils'

export async function scanComOle(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  const shellExtKeys = [
    'HKCR\\*\\shellex\\ContextMenuHandlers',
    'HKCR\\Directory\\shellex\\ContextMenuHandlers',
    'HKCR\\Folder\\shellex\\ContextMenuHandlers',
  ]
  for (const shellKey of shellExtKeys) {
    try {
      const { stdout } = await execReg(['query', shellKey, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const clsidMatch = block.match(/\(Default\)\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
        if (clsidMatch) {
          const clsid = clsidMatch[1]
          if (!clsid) continue
          const keyMatch = block.match(/^(HK[^\r\n]+)/m)
          if (!(await clsidExists(clsid, signal))) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch?.[1]?.trim() || shellKey,
              valueName: clsid,
              issue: `Context menu handler references missing COM object: ${clsid}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          } else {
            const missingDll = await findMissingClsidDll(clsid, signal)
            if (missingDll) {
              entries.push({
                id: randomUUID(),
                type: 'broken',
                keyPath: keyMatch?.[1]?.trim() || shellKey,
                valueName: clsid,
                issue:
                  missingDll === 'no-inproc'
                    ? `Context menu handler has broken COM registration: ${clsid}`
                    : `Context menu handler DLL missing: ${missingDll}`,
                risk: 'medium',
                selected: true,
                fix: { op: 'delete-key' },
              })
            }
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const { stdout } = await execReg(['query', 'HKCR\\CLSID', '/s', '/f', 'InprocServer32', '/k'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let comCount = 0
    for (const block of blocks) {
      if (comCount >= 50) break
      const keyMatch = block.match(/^(HKCR\\CLSID\\(\{[^}]+\})\\InprocServer32)/m)
      const dllMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (keyMatch && dllMatch) {
        const dllPath = (dllMatch[1] ?? '').trim().replace(/"/g, '')
        if (dllPath?.includes('\\') && !dllPath.startsWith('%') && !existsSync(dllPath)) {
          const parentClsidKey = `HKCR\\CLSID\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'broken',
            keyPath: keyMatch[1]!,
            valueName: '(Default)',
            issue: `COM object DLL missing: ${dllPath}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key', key: parentClsidKey },
          })
          comCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKCR\\TypeLib', '/s', '/f', 'win32', '/k'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let tlbCount = 0
    for (const block of blocks) {
      if (tlbCount >= 30) break
      const keyMatch = block.match(/^(HKCR\\TypeLib\\(\{[^}]+\})[^\r\n]*)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (keyMatch && valMatch) {
        const tlbPath = (valMatch[1] ?? '').trim().replace(/"/g, '')
        if (tlbPath?.includes('\\') && !tlbPath.startsWith('%') && !existsSync(tlbPath)) {
          const parentTypeLibKey = `HKCR\\TypeLib\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: '(Default)',
            issue: `Type library file missing: ${tlbPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key', key: parentTypeLibKey },
          })
          tlbCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  const bhoKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects',
  ]
  for (const bhoKey of bhoKeys) {
    try {
      const { stdout } = await execReg(['query', bhoKey], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const subKeyMatch = line.match(/^(HKLM\\[^\\]+.*\\(\{[0-9A-Fa-f-]+\}))$/m)
        if (!subKeyMatch) continue
        const bhoSubKey = subKeyMatch[1]!.trim()
        const clsid = subKeyMatch[2]!
        if (!(await clsidExists(clsid, signal))) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: bhoSubKey,
            valueName: clsid,
            issue: `Browser Helper Object references missing COM object: ${clsid}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        } else {
          const missingDll = await findMissingClsidDll(clsid, signal)
          if (missingDll) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: bhoSubKey,
              valueName: clsid,
              issue:
                missingDll === 'no-inproc'
                  ? `Browser Helper Object has broken COM registration: ${clsid}`
                  : `Browser Helper Object DLL missing: ${missingDll}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const eventLogKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application'
    const { stdout } = await execReg(['query', eventLogKey], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const subKeyMatch = line.match(/^(HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\(.+))$/m)
      if (!subKeyMatch) continue
      const sourceKey = subKeyMatch[1]!.trim()
      const sourceName = subKeyMatch[2]!.trim()
      if (
        sourceName.toLowerCase().startsWith('microsoft') ||
        sourceName.toLowerCase().startsWith('windows') ||
        sourceName.toLowerCase().startsWith('.net') ||
        sourceName.toLowerCase() === 'application' ||
        sourceName.toLowerCase() === 'application error' ||
        sourceName.toLowerCase() === 'application hang' ||
        sourceName.toLowerCase() === 'eventlog' ||
        sourceName.toLowerCase() === 'vssetup'
      )
        continue
      try {
        const { stdout: srcOut } = await execReg(['query', sourceKey, '/v', 'EventMessageFile'], {
          timeout: 5000,
          ...(signal ? { signal } : {}),
        })
        const pathMatch = srcOut.match(/EventMessageFile\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        if (pathMatch) {
          const rawValue = (pathMatch[1] ?? '').trim().replace(/"/g, '')
          const winDir = process.env.WINDIR || 'C:\\Windows'
          const allPaths = rawValue
            .split(/[;,]/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
            .map((p) => p.replace(/%SystemRoot%/i, winDir))
          if (allPaths.some((p) => p.startsWith('%'))) continue
          const checkable = allPaths.filter((p) => p.includes('\\'))
          if (checkable.length > 0 && checkable.every((p) => !existsSync(p))) {
            let hasPrimaryModule = false
            try {
              const { stdout: pmOut } = await execReg(['query', sourceKey, '/v', 'PrimaryModule'], {
                timeout: 3000,
                ...(signal ? { signal } : {}),
              })
              if (pmOut.includes('PrimaryModule')) hasPrimaryModule = true
            } catch {
              /* no PrimaryModule */
            }
            if (!hasPrimaryModule) {
              entries.push({
                id: randomUUID(),
                type: 'orphaned',
                keyPath: sourceKey,
                valueName: 'EventMessageFile',
                issue: `Event log source "${sourceName}" — all message files missing`,
                risk: 'low',
                selected: true,
                fix: { op: 'delete-key' },
              })
            }
          }
        }
      } catch {
        /* No EventMessageFile value */
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKCR\\Interface', '/s', '/f', 'ProxyStubClsid32'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let ifaceCount = 0
    for (const block of blocks) {
      if (ifaceCount >= 30) break
      const keyMatch = block.match(/^(HKCR\\Interface\\(\{[^}]+\})\\ProxyStubClsid32)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
      if (keyMatch && valMatch) {
        const proxyClsid = valMatch[1]
        if (!proxyClsid) continue
        if (
          proxyClsid === '{00000320-0000-0000-C000-000000000046}' ||
          proxyClsid === '{0000033A-0000-0000-C000-000000000046}'
        )
          continue
        if (!(await clsidExists(proxyClsid, signal))) {
          const parentIfaceKey = `HKCR\\Interface\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: proxyClsid,
            issue: `COM interface references missing proxy stub: ${proxyClsid}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key', key: parentIfaceKey },
          })
          ifaceCount++
        } else {
          const missingDll = await findMissingClsidDll(proxyClsid, signal)
          if (missingDll) {
            const parentIfaceKey = `HKCR\\Interface\\${keyMatch[2]!}`
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch[1]!,
              valueName: proxyClsid,
              issue:
                missingDll === 'no-inproc'
                  ? `COM interface proxy stub has broken registration: ${proxyClsid}`
                  : `COM interface proxy stub DLL missing: ${missingDll}`,
              risk: 'medium',
              selected: true,
              fix: { op: 'delete-key', key: parentIfaceKey },
            })
            ifaceCount++
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const fileExtsKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts'
    const { stdout } = await execReg(['query', fileExtsKey, '/s', '/f', 'UserChoice'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCU\\[^\r\n]*\\UserChoice)/m)
      const progIdMatch = block.match(/ProgId\s+REG_SZ\s+(.+)/i)
      if (keyMatch && progIdMatch) {
        const progId = (progIdMatch[1] ?? '').trim()
        if (
          !progId ||
          progId.startsWith('AppX') ||
          progId.startsWith('Microsoft.') ||
          progId.startsWith('Windows.') ||
          progId === 'Applications' ||
          progId.startsWith('IE.') ||
          progId.startsWith('MSEdge') ||
          progId.startsWith('Acrobat') ||
          progId.startsWith('WMP')
        )
          continue
        try {
          await execReg(['query', `HKCR\\${progId}`], { timeout: 3000, ...(signal ? { signal } : {}) })
        } catch {
          const extMatch = keyMatch[1]!.match(/FileExts\\([^\\]+)\\UserChoice/)
          const ext = extMatch ? extMatch[1] : 'unknown'
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: 'ProgId',
            issue: `Default app for "${ext}" references removed program: ${progId}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const mimeKey = 'HKCR\\MIME\\Database\\Content Type'
    const { stdout } = await execReg(['query', mimeKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCR\\MIME\\Database\\Content Type\\[^\r\n]+)/m)
      const clsidMatch = block.match(/CLSID\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
      if (keyMatch && clsidMatch) {
        const clsid = clsidMatch[1]
        if (!clsid) continue
        if (!(await clsidExists(clsid, signal))) {
          const mimeType = keyMatch[1]!.replace('HKCR\\MIME\\Database\\Content Type\\', '')
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: 'CLSID',
            issue: `MIME type "${mimeType}" references missing handler: ${clsid}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const autoPlayKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers\\Handlers'
    const { stdout } = await execReg(['query', autoPlayKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKLM\\[^\r\n]+)/m)
      if (!keyMatch || keyMatch[1]! === autoPlayKey) continue
      const progIdMatch = block.match(/ProgID\s+REG_SZ\s+(.+)/i)
      if (progIdMatch) {
        const progId = (progIdMatch[1] ?? '').trim()
        if (progId) {
          try {
            await execReg(['query', `HKCR\\${progId}`], { timeout: 5000, ...(signal ? { signal } : {}) })
          } catch {
            const handlerName = keyMatch[1]!.split('\\').pop() || 'Unknown'
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch[1]!,
              valueName: 'ProgID',
              issue: `AutoPlay handler "${handlerName}" references missing ProgID: ${progId}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  const clientLabels = [
    { subKey: 'StartMenuInternet', label: 'web browser' },
    { subKey: 'Mail', label: 'email client' },
    { subKey: 'Media', label: 'media player' },
    { subKey: 'News', label: 'news reader' },
    { subKey: 'Calendar', label: 'calendar app' },
  ]
  const clientRoots = ['HKLM\\SOFTWARE\\Clients', 'HKLM\\SOFTWARE\\WOW6432Node\\Clients', 'HKCU\\SOFTWARE\\Clients']
  const clientCategories: { key: string; label: string }[] = []
  for (const root of clientRoots) {
    for (const { subKey, label } of clientLabels) {
      clientCategories.push({ key: `${root}\\${subKey}`, label })
    }
  }
  for (const client of clientCategories) {
    try {
      const { stdout } = await execReg(['query', client.key], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const subKeyMatch = line.match(/^(HK\w+\\SOFTWARE\\(?:WOW6432Node\\)?Clients\\[^\\]+\\(.+))$/m)
        if (!subKeyMatch) continue
        const subKey = subKeyMatch[1]!.trim()
        const clientName = subKeyMatch[2]!.trim()
        if (
          clientName.toLowerCase().includes('microsoft') ||
          clientName.toLowerCase().includes('windows') ||
          clientName.toLowerCase() === 'outlook'
        )
          continue
        try {
          const { stdout: cmdOut } = await execReg(['query', `${subKey}\\shell\\open\\command`], {
            timeout: 5000,
            ...(signal ? { signal } : {}),
          })
          const rawValMatch = cmdOut.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
          const exePath = rawValMatch ? extractExePath(rawValMatch[1]!.trim()) : null
          if (exePath?.includes('\\') && !exePath.startsWith('%') && !existsSync(exePath)) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: subKey,
              valueName: 'shell\\open\\command',
              issue: `Registered ${client.label} "${clientName}" points to missing executable: ${exePath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        } catch {
          /* No shell command */
        }
      }
    } catch {
      /* Skip */
    }
  }

  return entries
}
