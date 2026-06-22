import { regDeleteValue, regSetDword } from '../helpers'

export function applyTelemetryLevel(): Promise<void> {
  return regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 0)
}
export function revertTelemetryLevel(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry')
}

export function applyActivityHistory(): Promise<void> {
  return regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed', 0)
}
export function revertActivityHistory(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed')
}

export function applyPublishActivity(): Promise<void> {
  return regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities', 0)
}
export function revertPublishActivity(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities')
}

export function applyFeedbackFrequency(): Promise<void> {
  return regSetDword('HKCU\\SOFTWARE\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 0)
}
export function revertFeedbackFrequency(): Promise<void> {
  return regDeleteValue('HKCU\\SOFTWARE\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod')
}

export async function applyHandwritingTelemetry(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Input\\TIPC', 'Enabled', 0)
}
export async function revertHandwritingTelemetry(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Input\\TIPC', 'Enabled', 1)
}

export async function applyInputPersonalization(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy', 0)
}
export async function revertInputPersonalization(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy', 1)
}

export async function applyTailoredExperiences(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy',
    'TailoredExperiencesWithDiagnosticDataEnabled',
    0,
  )
}
export async function revertTailoredExperiences(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy',
    'TailoredExperiencesWithDiagnosticDataEnabled',
    1,
  )
}

export async function applyAppLaunchTracking(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Start_TrackProgs', 0)
}
export async function revertAppLaunchTracking(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Start_TrackProgs', 1)
}
