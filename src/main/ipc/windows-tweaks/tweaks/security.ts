import type { WindowsTweakDef } from '@shared/types'
import type { WindowGetter } from '../../index'

export const SECURITY_TWEAKS: WindowsTweakDef[] = [
  // Privacy
  {
    id: 'telemetria-off',
    name: 'Telemetria — OFF',
    description: 'Desativa coleta de dados de telemetria da Microsoft',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection',
    key: 'AllowTelemetry',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'background-apps',
    name: 'Background Apps — OFF',
    description: 'Desativa execução de apps em segundo plano',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_CURRENT_USER',
    path: 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications',
    key: 'GlobalUserDisabled',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'allow-cortana-off',
    name: 'Cortana — OFF',
    description: 'Desativa assistente Cortana',
    category: 'privacy',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search',
    key: 'AllowCortana',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },

  // VBS (Virtualization-Based Security)
  {
    id: 'vbs-hvci',
    name: 'VBS Hypervisor Code Integrity — OFF',
    description: 'Desativa integridade de código HVCI (Virtualization-Based Security)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity',
    key: 'Enabled',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'vbs-lsa-cfg',
    name: 'VBS LSA Credential Guard — OFF',
    description: 'Desativa Credential Guard (LSA) do VBS',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\Lsa',
    key: 'LsaCfgFlags',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'vbs-enable',
    name: 'VBS Virtualization — OFF',
    description: 'Desativa Virtualization Based Security (recupera performance)',
    category: 'system',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
    key: 'EnableVirtualizationBasedSecurity',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
    needsReboot: true,
  },
]

export function registerSecurityTweaks(_getWindow: WindowGetter): void {
  // No security-specific IPC handlers currently
}
