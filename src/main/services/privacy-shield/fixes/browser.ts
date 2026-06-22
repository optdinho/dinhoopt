import { regDeleteValue, regSetDword } from '../helpers'

export async function applyEdgeMetrics(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'MetricsReportingEnabled', 0)
}
export function revertEdgeMetrics(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'MetricsReportingEnabled')
}

export async function applyEdgeSiteInfo(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'SendSiteInfoToImproveServices', 0)
}
export function revertEdgeSiteInfo(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'SendSiteInfoToImproveServices')
}

export async function applyEdgePersonalization(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'PersonalizationReportingEnabled', 0)
}
export function revertEdgePersonalization(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'PersonalizationReportingEnabled')
}

export async function applyEdgeCopilotCdp(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotCDPPageContext', 0)
}
export function revertEdgeCopilotCdp(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotCDPPageContext')
}

export async function applyEdgeCopilotPage(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotPageContext', 0)
}
export function revertEdgeCopilotPage(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'CopilotPageContext')
}

export async function applyEdgeDiscover(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'DiscoverPageContextEnabled', 0)
}
export function revertEdgeDiscover(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'DiscoverPageContextEnabled')
}

export async function applyEdgeSidebar(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'HubsSidebarEnabled', 0)
}
export function revertEdgeSidebar(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'HubsSidebarEnabled')
}

export async function applyEdgeShopping(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'EdgeShoppingAssistantEnabled', 0)
}
export function revertEdgeShopping(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'EdgeShoppingAssistantEnabled')
}

export async function applyChromeMetrics(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'MetricsReportingEnabled', 0)
}
export function revertChromeMetrics(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'MetricsReportingEnabled')
}

export async function applyChromeFeedback(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'UserFeedbackAllowed', 0)
}
export function revertChromeFeedback(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'UserFeedbackAllowed')
}

export async function applyChromeExtendedReporting(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'SafeBrowsingExtendedReportingEnabled', 0)
}
export function revertChromeExtendedReporting(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'SafeBrowsingExtendedReportingEnabled')
}

export async function applyFirefoxTelemetry(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableTelemetry', 1)
}
export function revertFirefoxTelemetry(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableTelemetry')
}

export async function applyFirefoxDefaultAgent(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableDefaultBrowserAgent', 1)
}
export function revertFirefoxDefaultAgent(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox', 'DisableDefaultBrowserAgent')
}
