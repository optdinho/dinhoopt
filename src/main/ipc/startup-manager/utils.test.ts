import { describe, expect, it } from 'vitest'
import {
  ALLOWED_STARTUP_LOCATIONS,
  deriveDisplayName,
  estimateImpact,
  extractPublisher,
  friendlyExeName,
  isSafeTaskName,
  makeStableId,
  stripComment,
} from './utils'

describe('makeStableId', () => {
  it('produces a 16-character hex string', () => {
    const id = makeStableId('Spotify', 'registry-hkcu')
    expect(id).toMatch(/^[a-f0-9]{16}$/)
  })

  it('is deterministic for the same inputs', () => {
    expect(makeStableId('Discord', 'registry-hkcu')).toBe(makeStableId('Discord', 'registry-hkcu'))
  })

  it('differs for different names', () => {
    expect(makeStableId('Spotify', 'registry-hkcu')).not.toBe(makeStableId('Discord', 'registry-hkcu'))
  })

  it('differs for different sources', () => {
    expect(makeStableId('Spotify', 'registry-hkcu')).not.toBe(makeStableId('Spotify', 'registry-hklm'))
  })
})

describe('friendlyExeName', () => {
  it('returns known name for msedge', () => {
    expect(friendlyExeName('msedge')).toBe('Microsoft Edge')
  })

  it('is case-insensitive for known exes', () => {
    expect(friendlyExeName('MSEDGE')).toBe('Microsoft Edge')
    expect(friendlyExeName('Chrome')).toBe('Google Chrome')
  })

  it('returns known name for docker desktop', () => {
    expect(friendlyExeName('docker desktop')).toBe('Docker Desktop')
  })

  it('returns known name for lghub_system_tray', () => {
    expect(friendlyExeName('lghub_system_tray')).toBe('Logitech G HUB')
  })

  it('splits camelCase names', () => {
    expect(friendlyExeName('myCustomApp')).toBe('my Custom App')
  })

  it('replaces underscores and hyphens with spaces', () => {
    expect(friendlyExeName('my_app_name')).toBe('my app name')
    expect(friendlyExeName('my-app-name')).toBe('my app name')
  })

  it('normalizes multiple spaces', () => {
    expect(friendlyExeName('my   app')).toBe('my app')
  })

  it('trims whitespace', () => {
    expect(friendlyExeName('  myApp  ')).toBe('my App')
  })

  it('handles empty string', () => {
    expect(friendlyExeName('')).toBe('')
  })
})

describe('deriveDisplayName', () => {
  it('extracts name from electron.app.X pattern', () => {
    expect(deriveDisplayName('electron.app.Discord', '"C:\\Discord\\Discord.exe" --start-minimized')).toBe('Discord')
  })

  it('falls back to registryName when electron.app.X capture is null', () => {
    const result = deriveDisplayName('electron.app.', '"C:\\App\\app.exe"')
    expect(result).toBe('electron.app.')
  })

  it('derives from hex-suffixed names using short prefix', () => {
    expect(deriveDisplayName('Steam_ABCDEF12', '"C:\\Steam\\Steam.exe"')).toBe('Steam')
  })

  it('falls back to friendlyExeName for long hex-suffixed prefix with exe', () => {
    expect(deriveDisplayName('VeryLongApplicationNameThatExceeds_ABCDEF12', '"C:\\App\\discord.exe"')).toBe('Discord')
  })

  it('returns prefix for long hex-suffix when exeName is empty', () => {
    expect(deriveDisplayName('ThisNameIsWayTooLong_ABCDEF12345678', '')).toBe('ThisNameIsWayTooLong')
  })

  it('returns readable registry names as-is when they contain a space', () => {
    expect(deriveDisplayName('My App', '"C:\\App\\app.exe"')).toBe('My App')
  })

  it('returns readable registry names as-is when short and alphanumeric', () => {
    expect(deriveDisplayName('Spotify', '"C:\\Spotify\\Spotify.exe"')).toBe('Spotify')
    expect(deriveDisplayName('OneDrive', '"C:\\OneDrive\\OneDrive.exe"')).toBe('OneDrive')
  })

  it('returns readable registry names with Unicode letters', () => {
    expect(deriveDisplayName('Música', '"C:\\App\\app.exe"')).toBe('Música')
    expect(deriveDisplayName('NovaAplicação', '"C:\\App\\app.exe"')).toBe('NovaAplicação')
  })

  it('falls back to friendlyExeName for unreadable registry names with exe', () => {
    expect(deriveDisplayName('{CLSID-GUID-HERE}', '"C:\\Program Files\\chrome.exe"')).toBe('Google Chrome')
  })

  it('returns registryName when unreadable and no exeName', () => {
    expect(deriveDisplayName('{CLSID-GUID-HERE}', '')).toBe('{CLSID-GUID-HERE}')
  })

  it('handles known exe mappings via exe path when registryName is unreadable', () => {
    expect(deriveDisplayName('{GUID}', '"C:\\msedge.exe"')).toBe('Microsoft Edge')
    expect(deriveDisplayName('{GUID}', '"C:\\slack.exe"')).toBe('Slack')
    expect(deriveDisplayName('{GUID}', '"C:\\lghub_system_tray.exe"')).toBe('Logitech G HUB')
  })

  it('camelCase splits for unknown exe names', () => {
    expect(deriveDisplayName('{X}', '"C:\\MyCustomApp.exe"')).toBe('My Custom App')
  })

  it('extracts path from unquoted .exe command', () => {
    expect(deriveDisplayName('{GUID}', 'C:\\Programs\\firefox.exe --silent')).toBe('Mozilla Firefox')
  })

  it('falls back to first token when no .exe in command', () => {
    expect(deriveDisplayName('{X}', 'somecommand --flag')).toBe('somecommand')
  })

  it('returns empty string for completely empty command with unreadable name', () => {
    expect(deriveDisplayName('{X}', '')).toBe('{X}')
  })

  it('strips extension from exe name', () => {
    expect(deriveDisplayName('ReadableName', '"C:\\App\\thing.exe"')).toBe('ReadableName')
  })

  it('handles registryName with special chars that pass the readable test', () => {
    expect(deriveDisplayName('App.Name_Version (x64)', '"C:\\App\\app.exe"')).toBe('App.Name_Version (x64)')
  })

  it('rejects long registryNames (>30) without spaces as unreadable', () => {
    expect(deriveDisplayName('ThisIsAVeryLongRegistryNameWithoutAnySpaces', '"C:\\App\\app.exe"')).toBe('app')
  })

  it('properly normalizes backslash to forward slash', () => {
    expect(deriveDisplayName('{GUID}', '"C:\\Users\\Test\\App.exe"')).toBe('App')
  })
})

describe('stripComment', () => {
  it('returns full string when no semicolon', () => {
    expect(stripComment('"C:\\App\\app.exe" --flag')).toBe('"C:\\App\\app.exe" --flag')
  })

  it('strips comment starting at first semicolon outside quotes', () => {
    expect(stripComment('"C:\\App\\app.exe" --flag; comment here')).toBe('"C:\\App\\app.exe" --flag')
  })

  it('preserves semicolons inside quoted strings', () => {
    expect(stripComment('"C:\\App;name\\app.exe" --flag')).toBe('"C:\\App;name\\app.exe" --flag')
  })

  it('handles multiple quote pairs with semicolon after', () => {
    expect(stripComment('"first" "second"; comment')).toBe('"first" "second"')
  })

  it('handles semicolon at the start of string', () => {
    expect(stripComment(';comment only')).toBe('')
  })

  it('handles empty string', () => {
    expect(stripComment('')).toBe('')
  })

  it('handles semicolon inside and outside quotes', () => {
    expect(stripComment('"C:\\App\\app.exe" --flag; "extra"')).toBe('"C:\\App\\app.exe" --flag')
  })

  it('handles unbalanced quotes — semicolon inside quotes is not stripped', () => {
    expect(stripComment('"unbalanced; still stripped')).toBe('"unbalanced; still stripped')
  })

  it('trims trailing whitespace before comment', () => {
    expect(stripComment('app.exe   ; comment')).toBe('app.exe')
  })

  it('preserves string with only whitespace', () => {
    expect(stripComment('   ')).toBe('   ')
  })

  it('handles multiple consecutive semicolons', () => {
    expect(stripComment('app.exe;;;')).toBe('app.exe')
  })
})

describe('extractPublisher', () => {
  it('returns "Unknown" for undefined', () => {
    expect(extractPublisher(undefined)).toBe('Unknown')
  })

  it('returns "Unknown" for empty string', () => {
    expect(extractPublisher('')).toBe('Unknown')
  })

  it('detects Google', () => {
    expect(extractPublisher('"C:\\Google\\Chrome\\chrome.exe"')).toBe('Google LLC')
  })

  it('detects Microsoft by backslash path', () => {
    expect(extractPublisher('"C:\\Program Files\\Microsoft\\Edge\\msedge.exe"')).toBe('Microsoft Corporation')
  })

  it('detects Microsoft via "microsoft edge" literal string', () => {
    expect(extractPublisher('"C:\\Program Files\\Microsoft Edge\\msedge.exe"')).toBe('Microsoft Corporation')
  })

  it('detects Microsoft Teams by backslash msteams', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Local\\MSTeams\\Update.exe"')).toBe('Microsoft Corporation')
  })

  it('detects OneDrive', () => {
    expect(extractPublisher('"C:\\Users\\User\\OneDrive\\OneDrive.exe"')).toBe('Microsoft Corporation')
  })

  it('detects Discord', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe"')).toBe('Discord Inc.')
  })

  it('detects Spotify', () => {
    expect(extractPublisher('"C:\\Spotify\\Spotify.exe"')).toBe('Spotify AB')
  })

  it('detects Steam', () => {
    expect(extractPublisher('"C:\\Program Files (x86)\\Steam\\Steam.exe"')).toBe('Valve Corporation')
  })

  it('detects NVIDIA', () => {
    expect(extractPublisher('"C:\\NVIDIA\\NvDisplay.exe"')).toBe('NVIDIA Corporation')
  })

  it('detects AMD', () => {
    expect(extractPublisher('"C:\\AMD\\Radeon\\cnext.exe"')).toBe('AMD')
  })

  it('detects Radeon', () => {
    expect(extractPublisher('"C:\\Program Files\\Radeon\\app.exe"')).toBe('AMD')
  })

  it('detects Intel', () => {
    expect(extractPublisher('"C:\\Intel\\Graphics\\app.exe"')).toBe('Intel Corporation')
  })

  it('detects Mozilla', () => {
    expect(extractPublisher('"C:\\Program Files\\Mozilla\\Firefox\\firefox.exe"')).toBe('Mozilla Foundation')
  })

  it('detects Firefox', () => {
    expect(extractPublisher('"C:\\Program Files\\Firefox\\firefox.exe"')).toBe('Mozilla Foundation')
  })

  it('detects Notion', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Local\\Notion\\Notion.exe"')).toBe('Notion Labs')
  })

  it('detects Slack', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Local\\Slack\\slack.exe"')).toBe('Salesforce')
  })

  it('detects Zoom', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Roaming\\Zoom\\Zoom.exe"')).toBe('Zoom Video Communications')
  })

  it('detects Adobe', () => {
    expect(extractPublisher('"C:\\Adobe\\CCDesktop.exe"')).toBe('Adobe Inc.')
  })

  it('detects Logitech', () => {
    expect(extractPublisher('"C:\\Program Files\\Logitech\\app.exe"')).toBe('Logitech')
  })

  it('detects LGHUB', () => {
    expect(extractPublisher('"C:\\Program Files\\LGHUB\\app.exe"')).toBe('Logitech')
  })

  it('detects Corsair', () => {
    expect(extractPublisher('"C:\\Program Files\\Corsair\\app.exe"')).toBe('Corsair')
  })

  it('detects iCUE', () => {
    expect(extractPublisher('"C:\\Program Files\\iCUE\\app.exe"')).toBe('Corsair')
  })

  it('detects Razer', () => {
    expect(extractPublisher('"C:\\Program Files\\Razer\\app.exe"')).toBe('Razer Inc.')
  })

  it('detects Docker', () => {
    expect(extractPublisher('"C:\\Docker Desktop\\Docker.exe"')).toBe('Docker Inc.')
  })

  it('detects Proton', () => {
    expect(extractPublisher('"C:\\Users\\User\\AppData\\Local\\Proton\\app.exe"')).toBe('Proton AG')
  })

  it('detects Dropbox', () => {
    expect(extractPublisher('"C:\\Users\\User\\Dropbox\\Dropbox.exe"')).toBe('Dropbox Inc.')
  })

  it('detects 1Password', () => {
    expect(extractPublisher('"C:\\Program Files\\1Password\\app.exe"')).toBe('AgileBits Inc.')
  })

  it('detects Realtek', () => {
    expect(extractPublisher('"C:\\Windows\\System32\\Realtek\\app.exe"')).toBe('Realtek')
  })

  it('detects HP', () => {
    expect(extractPublisher('"C:\\Program Files\\HP\\app.exe"')).toBe('HP Inc.')
  })

  it('detects Hewlett', () => {
    expect(extractPublisher('"C:\\Program Files\\Hewlett-Packard\\app.exe"')).toBe('HP Inc.')
  })

  it('detects Dell', () => {
    expect(extractPublisher('"C:\\Program Files\\Dell\\app.exe"')).toBe('Dell Technologies')
  })

  it('detects Lenovo', () => {
    expect(extractPublisher('"C:\\Program Files\\Lenovo\\app.exe"')).toBe('Lenovo')
  })

  it('detects ASUS', () => {
    expect(extractPublisher('"C:\\Program Files\\ASUS\\app.exe"')).toBe('ASUS')
  })

  it('detects Clair', () => {
    expect(extractPublisher('"C:\\Program Files\\Clair\\app.exe"')).toBe('Clair')
  })

  it('returns "Unknown" for unrecognized paths', () => {
    expect(extractPublisher('"C:\\MyApp\\app.exe"')).toBe('Unknown')
  })
})

describe('estimateImpact', () => {
  it('classifies Windows Defender as none', () => {
    expect(estimateImpact('SecurityHealth', 'SecurityHealthSystray.exe')).toBe('none')
  })

  it('classifies Windows Defender by standalone name', () => {
    expect(estimateImpact('windowsdefender', '')).toBe('none')
  })

  it('classifies SecurityCenter as none', () => {
    expect(estimateImpact('SecurityCenter', '')).toBe('none')
  })

  it('detects "windows defender" with space in name', () => {
    expect(estimateImpact('Windows Defender Notification', '')).toBe('none')
  })

  it('classifies Chrome as high impact', () => {
    expect(estimateImpact('GoogleChrome', 'chrome.exe')).toBe('high')
  })

  it('classifies Discord as high impact', () => {
    expect(estimateImpact('Discord', '"C:\\discord\\Update.exe"')).toBe('high')
  })

  it('classifies Teams as high impact', () => {
    expect(estimateImpact('Teams', '"C:\\Teams\\app.exe"')).toBe('high')
  })

  it('classifies ms-teams as high impact', () => {
    expect(estimateImpact('ms-teams', '"C:\\MSTeams\\app.exe"')).toBe('high')
  })

  it('classifies Slack as high impact', () => {
    expect(estimateImpact('Slack', '"C:\\slack\\app.exe"')).toBe('high')
  })

  it('classifies Steam as high impact', () => {
    expect(estimateImpact('Steam', '"C:\\steam\\Steam.exe"')).toBe('high')
  })

  it('classifies Edge as high impact', () => {
    expect(estimateImpact('Edge', '"C:\\msedge.exe"')).toBe('high')
  })

  it('classifies msedge as high impact', () => {
    expect(estimateImpact('MicrosoftEdgeUpdate', '')).toBe('high')
  })

  it('classifies Docker as high impact', () => {
    expect(estimateImpact('Docker', '"C:\\docker\\app.exe"')).toBe('high')
  })

  it('classifies Spotify as medium impact', () => {
    expect(estimateImpact('Spotify', '"C:\\spotify.exe"')).toBe('medium')
  })

  it('classifies OneDrive as medium impact', () => {
    expect(estimateImpact('OneDrive', '"C:\\OneDrive.exe"')).toBe('medium')
  })

  it('classifies Dropbox as medium impact', () => {
    expect(estimateImpact('Dropbox', '"C:\\dropbox.exe"')).toBe('medium')
  })

  it('classifies Adobe as medium impact', () => {
    expect(estimateImpact('Adobe', '"C:\\adobe.exe"')).toBe('medium')
  })

  it('classifies Notion as medium impact', () => {
    expect(estimateImpact('Notion', '"C:\\notion.exe"')).toBe('medium')
  })

  it('classifies Zoom as medium impact', () => {
    expect(estimateImpact('Zoom', '"C:\\zoom.exe"')).toBe('medium')
  })

  it('classifies Firefox as medium impact', () => {
    expect(estimateImpact('Firefox', '"C:\\firefox.exe"')).toBe('medium')
  })

  it('classifies unknown apps as low impact', () => {
    expect(estimateImpact('MyCustomApp', 'custom.exe')).toBe('low')
  })

  it('checks both name and command for keywords', () => {
    expect(estimateImpact('UpdateHelper', 'C:\\docker\\helper.exe')).toBe('high')
  })

  it('classifies as low when name alone has no match', () => {
    expect(estimateImpact('Helper', '')).toBe('low')
  })
})

describe('isSafeTaskName', () => {
  it('accepts simple names', () => {
    expect(isSafeTaskName('SpotifyStartup')).toBe(true)
    expect(isSafeTaskName('My Task (v2)')).toBe(true)
    expect(isSafeTaskName('App-Update.1.0')).toBe(true)
  })

  it('accepts names with Unicode letters', () => {
    expect(isSafeTaskName('MúsicaStartup')).toBe(true)
    expect(isSafeTaskName('Éléctron_App')).toBe(true)
  })

  it('accepts names with Unicode numbers', () => {
    expect(isSafeTaskName('Task١٢٣')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isSafeTaskName('')).toBe(false)
  })

  it('rejects names with shell metacharacters', () => {
    expect(isSafeTaskName("task'; rm -rf /")).toBe(false)
    expect(isSafeTaskName('task | evil')).toBe(false)
    expect(isSafeTaskName('task`cmd`')).toBe(false)
    expect(isSafeTaskName('task$var')).toBe(false)
  })

  it('rejects names longer than 260 chars', () => {
    expect(isSafeTaskName('a'.repeat(261))).toBe(false)
  })

  it('accepts names at exactly 260 chars', () => {
    expect(isSafeTaskName('a'.repeat(260))).toBe(true)
  })

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime behavior with non-string
    expect(isSafeTaskName(undefined)).toBe(false)
    // @ts-expect-error testing runtime behavior with non-string
    expect(isSafeTaskName(null)).toBe(false)
    // @ts-expect-error testing runtime behavior with non-string
    expect(isSafeTaskName(123)).toBe(false)
  })
})

describe('ALLOWED_STARTUP_LOCATIONS', () => {
  it('contains all three known Run key locations', () => {
    expect(ALLOWED_STARTUP_LOCATIONS.has('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run')).toBe(true)
    expect(ALLOWED_STARTUP_LOCATIONS.has('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run')).toBe(true)
    expect(ALLOWED_STARTUP_LOCATIONS.has('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')).toBe(
      true,
    )
  })

  it('does not contain arbitrary registry paths', () => {
    expect(ALLOWED_STARTUP_LOCATIONS.has('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce')).toBe(false)
    expect(ALLOWED_STARTUP_LOCATIONS.has('HKLM\\SOFTWARE\\Evil')).toBe(false)
    expect(ALLOWED_STARTUP_LOCATIONS.has('')).toBe(false)
  })

  it('has exactly 3 entries', () => {
    expect(ALLOWED_STARTUP_LOCATIONS.size).toBe(3)
  })
})
