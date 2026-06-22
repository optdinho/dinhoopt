import { regQueryDword } from '../helpers'

export async function checkTelemetryLevel(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry')
  return val === 0
}

export async function checkActivityHistory(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed')
  return val === 0
}

export async function checkPublishActivity(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities')
  return val === 0
}

export async function checkFeedbackFrequency(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod')
  return val === 0
}

export async function checkHandwritingTelemetry(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Input\\TIPC', 'Enabled')
  return val === 0
}

export async function checkInputPersonalization(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Personalization\\Settings', 'AcceptedPrivacyPolicy')
  return val === 0
}

export async function checkTailoredExperiences(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy',
    'TailoredExperiencesWithDiagnosticDataEnabled',
  )
  return val === 0
}

export async function checkAppLaunchTracking(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
    'Start_TrackProgs',
  )
  return val === 0
}
