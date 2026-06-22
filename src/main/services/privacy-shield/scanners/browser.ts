import { isBrowserInstalled, regQueryDword } from '../helpers'

export async function checkEdgeMetrics(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'MetricsReportingEnabled')
  return val === 0
}

export async function checkEdgeSiteInfo(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'SendSiteInfoToImproveServices')
  return val === 0
}

export async function checkEdgePersonalization(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'PersonalizationReportingEnabled')
  return val === 0
}

export async function checkEdgeCopilotCdp(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotCDPPageContext')
  return val === 0
}

export async function checkEdgeCopilotPage(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotPageContext')
  return val === 0
}

export async function checkEdgeDiscover(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'DiscoverPageContextEnabled')
  return val === 0
}

export async function checkEdgeSidebar(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'HubsSidebarEnabled')
  return val === 0
}

export async function checkEdgeShopping(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'EdgeShoppingAssistantEnabled')
  return val === 0
}

export async function checkChromeMetrics(): Promise<boolean> {
  if (!(await isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')))
    return true
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'MetricsReportingEnabled')
  return val === 0
}

export function applicableChromeMetrics(): Promise<boolean> {
  return isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')
}

export async function checkChromeFeedback(): Promise<boolean> {
  if (!(await isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')))
    return true
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'UserFeedbackAllowed')
  return val === 0
}

export function applicableChromeFeedback(): Promise<boolean> {
  return isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')
}

export async function checkChromeExtendedReporting(): Promise<boolean> {
  if (!(await isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')))
    return true
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'SafeBrowsingExtendedReportingEnabled')
  return val === 0
}

export function applicableChromeExtendedReporting(): Promise<boolean> {
  return isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe')
}

export async function checkFirefoxTelemetry(): Promise<boolean> {
  if (!(await isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe')))
    return true
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableTelemetry')
  return val === 1
}

export function applicableFirefoxTelemetry(): Promise<boolean> {
  return isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe')
}

export async function checkFirefoxDefaultAgent(): Promise<boolean> {
  if (!(await isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe')))
    return true
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableDefaultBrowserAgent')
  return val === 1
}

export function applicableFirefoxDefaultAgent(): Promise<boolean> {
  return isBrowserInstalled('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe')
}
