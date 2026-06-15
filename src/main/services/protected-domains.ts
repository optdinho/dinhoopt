export type DomainCategory =
  | 'microsoft-update'
  | 'microsoft-telemetry'
  | 'microsoft-security'
  | 'microsoft-identity'
  | 'microsoft-office'
  | 'microsoft-azure'
  | 'antivirus'
  | 'security'
  | 'financial'
  | 'government'
  | 'social-engineering'
  | 'c2-common'

export interface ProtectedDomain {
  domain: string
  category: DomainCategory
  description: string
  wildcard?: boolean
}

export const PROTECTED_DOMAINS: ProtectedDomain[] = [
  { domain: 'update.microsoft.com', category: 'microsoft-update', description: 'Windows Update', wildcard: true },
  { domain: 'windowsupdate.com', category: 'microsoft-update', description: 'Windows Update', wildcard: true },
  { domain: 'windowsupdate.microsoft.com', category: 'microsoft-update', description: 'Windows Update' },
  { domain: 'download.windowsupdate.com', category: 'microsoft-update', description: 'Windows Update downloads' },
  { domain: 'download.microsoft.com', category: 'microsoft-update', description: 'Microsoft downloads' },
  { domain: 'ntservicepack.microsoft.com', category: 'microsoft-update', description: 'Service pack updates' },
  { domain: 'update.microsoft.com.akadns.net', category: 'microsoft-update', description: 'Windows Update CDN' },
  { domain: 'wustat.windows.com', category: 'microsoft-update', description: 'Windows Update status' },
  { domain: 'au.download.windowsupdate.com', category: 'microsoft-update', description: 'Windows Update AU CDN' },
  { domain: 'stats.update.microsoft.com', category: 'microsoft-update', description: 'Update stats telemetry' },

  {
    domain: 'vortex.data.microsoft.com',
    category: 'microsoft-telemetry',
    description: 'Telemetry endpoint',
    wildcard: true,
  },
  {
    domain: 'vortex-win.data.microsoft.com',
    category: 'microsoft-telemetry',
    description: 'Windows telemetry',
    wildcard: true,
  },
  {
    domain: 'telecommand.telemetry.microsoft.com',
    category: 'microsoft-telemetry',
    description: 'Telecommand telemetry',
  },
  {
    domain: 'telecommand.telemetry.microsoft.com.nsatc.net',
    category: 'microsoft-telemetry',
    description: 'Telecommand CDN',
  },
  { domain: 'oca.telemetry.microsoft.com', category: 'microsoft-telemetry', description: 'OCA telemetry' },
  { domain: 'oca.telemetry.microsoft.com.nsatc.net', category: 'microsoft-telemetry', description: 'OCA CDN' },
  { domain: 'sqm.telemetry.microsoft.com', category: 'microsoft-telemetry', description: 'SQM telemetry' },
  { domain: 'sqm.telemetry.microsoft.com.nsatc.net', category: 'microsoft-telemetry', description: 'SQM CDN' },
  { domain: 'watson.telemetry.microsoft.com', category: 'microsoft-telemetry', description: 'Watson telemetry' },
  { domain: 'watson.telemetry.microsoft.com.nsatc.net', category: 'microsoft-telemetry', description: 'Watson CDN' },

  { domain: 'www.microsoft.com/security', category: 'microsoft-security', description: 'Microsoft Security' },
  { domain: 'security.microsoft.com', category: 'microsoft-security', description: 'Microsoft 365 Security' },
  { domain: 'protection.office.com', category: 'microsoft-security', description: 'Office Protection' },
  { domain: 'endpoint.microsoft.com', category: 'microsoft-security', description: 'Microsoft Endpoint Manager' },
  { domain: 'defender.microsoft.com', category: 'microsoft-security', description: 'Microsoft Defender' },
  { domain: 'oneget.microsoft.com', category: 'microsoft-security', description: 'Microsoft Package Manager' },
  { domain: 'www.microsoft.com/en-us/wdsi', category: 'microsoft-security', description: 'WDSI portal' },
  {
    domain: 'www.microsoft.com/en-us/security',
    category: 'microsoft-security',
    description: 'Microsoft Security portal',
  },

  {
    domain: 'login.microsoftonline.com',
    category: 'microsoft-identity',
    description: 'Microsoft Entra ID',
    wildcard: true,
  },
  { domain: 'login.live.com', category: 'microsoft-identity', description: 'Microsoft account login' },
  { domain: 'login.windows.net', category: 'microsoft-identity', description: 'Windows login' },
  { domain: 'account.microsoft.com', category: 'microsoft-identity', description: 'Microsoft account' },
  { domain: 'graph.microsoft.com', category: 'microsoft-identity', description: 'Microsoft Graph API' },
  { domain: 'graph.windows.net', category: 'microsoft-identity', description: 'Azure AD Graph' },

  { domain: 'office.com', category: 'microsoft-office', description: 'Office 365 portal', wildcard: true },
  { domain: 'office365.com', category: 'microsoft-office', description: 'Office 365' },
  { domain: 'outlook.office365.com', category: 'microsoft-office', description: 'Outlook online' },
  { domain: 'outlook.office.com', category: 'microsoft-office', description: 'Outlook online' },
  { domain: 'microsoft365.com', category: 'microsoft-office', description: 'Microsoft 365' },
  { domain: 'sharepoint.com', category: 'microsoft-office', description: 'SharePoint Online', wildcard: true },
  { domain: 'onedrive.live.com', category: 'microsoft-office', description: 'OneDrive' },
  { domain: 'teams.microsoft.com', category: 'microsoft-office', description: 'Microsoft Teams' },

  { domain: 'azure.com', category: 'microsoft-azure', description: 'Azure portal', wildcard: true },
  { domain: 'azure.microsoft.com', category: 'microsoft-azure', description: 'Azure portal' },
  { domain: 'management.azure.com', category: 'microsoft-azure', description: 'Azure management API' },
  { domain: 'management.core.windows.net', category: 'microsoft-azure', description: 'Azure service management' },
  { domain: 'database.windows.net', category: 'microsoft-azure', description: 'Azure SQL Database' },
  { domain: 'blob.core.windows.net', category: 'microsoft-azure', description: 'Azure Blob Storage' },
  { domain: 'table.core.windows.net', category: 'microsoft-azure', description: 'Azure Table Storage' },
  { domain: 'queue.core.windows.net', category: 'microsoft-azure', description: 'Azure Queue Storage' },

  { domain: 'www.symantec.com', category: 'antivirus', description: 'Norton/Symantec' },
  { domain: 'www.mcafee.com', category: 'antivirus', description: 'McAfee' },
  { domain: 'www.trendmicro.com', category: 'antivirus', description: 'Trend Micro' },
  { domain: 'www.avast.com', category: 'antivirus', description: 'Avast' },
  { domain: 'www.avg.com', category: 'antivirus', description: 'AVG' },
  { domain: 'www.kaspersky.com', category: 'antivirus', description: 'Kaspersky' },
  { domain: 'www.eset.com', category: 'antivirus', description: 'ESET' },
  { domain: 'www.bitdefender.com', category: 'antivirus', description: 'Bitdefender' },
  { domain: 'www.malwarebytes.com', category: 'antivirus', description: 'Malwarebytes' },
  { domain: 'virustotal.com', category: 'antivirus', description: 'VirusTotal' },
  { domain: 'www.virustotal.com', category: 'antivirus', description: 'VirusTotal' },
  { domain: 'www.sophos.com', category: 'antivirus', description: 'Sophos' },

  { domain: 'nvd.nist.gov', category: 'security', description: 'NVD' },
  { domain: 'cve.mitre.org', category: 'security', description: 'CVE database' },
  { domain: 'www.cve.org', category: 'security', description: 'CVE program' },
  { domain: 'msrc.microsoft.com', category: 'security', description: 'MSRC portal' },
  { domain: 'portal.msrc.microsoft.com', category: 'security', description: 'MSRC portal' },
  { domain: 'technet.microsoft.com', category: 'security', description: 'TechNet' },
  { domain: 'docs.microsoft.com', category: 'security', description: 'Microsoft Docs' },
  { domain: 'learn.microsoft.com', category: 'security', description: 'Microsoft Learn' },

  { domain: 'bankofamerica.com', category: 'financial', description: 'Bank of America', wildcard: true },
  { domain: 'chase.com', category: 'financial', description: 'Chase', wildcard: true },
  { domain: 'wellsfargo.com', category: 'financial', description: 'Wells Fargo', wildcard: true },
  { domain: 'citi.com', category: 'financial', description: 'Citibank', wildcard: true },
  { domain: 'capitalone.com', category: 'financial', description: 'Capital One', wildcard: true },
  { domain: 'paypal.com', category: 'financial', description: 'PayPal', wildcard: true },
  { domain: 'venmo.com', category: 'financial', description: 'Venmo', wildcard: true },
  { domain: 'stripe.com', category: 'financial', description: 'Stripe', wildcard: true },
  { domain: 'squareup.com', category: 'financial', description: 'Square' },
  { domain: 'robinhood.com', category: 'financial', description: 'Robinhood', wildcard: true },
  { domain: 'schwab.com', category: 'financial', description: 'Charles Schwab', wildcard: true },
  { domain: 'usbank.com', category: 'financial', description: 'US Bank', wildcard: true },

  { domain: 'usa.gov', category: 'government', description: 'US government portal', wildcard: true },
  { domain: 'whitehouse.gov', category: 'government', description: 'White House', wildcard: true },
  { domain: 'irs.gov', category: 'government', description: 'IRS', wildcard: true },
  { domain: 'ssa.gov', category: 'government', description: 'Social Security Admin', wildcard: true },
  { domain: 'fbi.gov', category: 'government', description: 'FBI', wildcard: true },
  { domain: 'nsa.gov', category: 'government', description: 'NSA' },
  { domain: 'dhs.gov', category: 'government', description: 'DHS', wildcard: true },
  { domain: 'defense.gov', category: 'government', description: 'Department of Defense', wildcard: true },

  { domain: 'google.com', category: 'social-engineering', description: 'Google', wildcard: true },
  { domain: 'youtube.com', category: 'social-engineering', description: 'YouTube', wildcard: true },
  { domain: 'facebook.com', category: 'social-engineering', description: 'Facebook', wildcard: true },
  { domain: 'instagram.com', category: 'social-engineering', description: 'Instagram', wildcard: true },
  { domain: 'twitter.com', category: 'social-engineering', description: 'X/Twitter', wildcard: true },
  { domain: 'linkedin.com', category: 'social-engineering', description: 'LinkedIn', wildcard: true },
  { domain: 'reddit.com', category: 'social-engineering', description: 'Reddit', wildcard: true },
  { domain: 'whatsapp.com', category: 'social-engineering', description: 'WhatsApp', wildcard: true },

  { domain: 'pastebin.com', category: 'c2-common', description: 'Pastebin (C2 data exfiltration)' },
  { domain: 'raw.githubusercontent.com', category: 'c2-common', description: 'GitHub raw (payload hosting)' },
  { domain: 'bit.ly', category: 'c2-common', description: 'Bitly (URL shortener abuse)' },
  { domain: 'tinyurl.com', category: 'c2-common', description: 'TinyURL (URL shortener abuse)' },
  { domain: 'discord.com', category: 'c2-common', description: 'Discord CDN (C2 hosting)' },
  { domain: 'cdn.discord.com', category: 'c2-common', description: 'Discord CDN' },
  { domain: 'telegram.org', category: 'c2-common', description: 'Telegram (C2 communication)' },
  { domain: 't.me', category: 'c2-common', description: 'Telegram link (C2)' },
]

export function isProtectedDomain(domain: string): boolean {
  const lower = domain.toLowerCase()
  return PROTECTED_DOMAINS.some((pd) => {
    if (pd.wildcard) {
      return lower === pd.domain || lower.endsWith(`.${pd.domain}`)
    }
    return lower === pd.domain
  })
}

export function searchProtectedDomains(query: string): ProtectedDomain[] {
  const lower = query.toLowerCase()
  return PROTECTED_DOMAINS.filter(
    (pd) => pd.domain.includes(lower) || pd.description.toLowerCase().includes(lower) || pd.category.includes(lower),
  )
}

export function isHighImpactDomain(domain: string): boolean {
  const highImpact: DomainCategory[] = [
    'microsoft-update',
    'microsoft-identity',
    'microsoft-security',
    'microsoft-office',
    'microsoft-azure',
  ]
  const lower = domain.toLowerCase()
  return PROTECTED_DOMAINS.some(
    (pd) => highImpact.includes(pd.category) && (lower === pd.domain || lower.endsWith(`.${pd.domain}`)),
  )
}

export type DomainSeverity = 'critical' | 'high' | 'medium' | 'low'

export function getDomainSeverity(domain: string): DomainSeverity {
  const lower = domain.toLowerCase()
  for (const pd of PROTECTED_DOMAINS) {
    const match = pd.wildcard ? lower === pd.domain || lower.endsWith(`.${pd.domain}`) : lower === pd.domain
    if (!match) continue
    if (pd.category === 'financial' || pd.category === 'government') return 'critical'
    if (pd.category === 'microsoft-update') return 'high'
    if (pd.category === 'c2-common') return 'medium'
    return 'critical'
  }
  return 'critical'
}
