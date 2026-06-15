import type { HostsEntry } from '@shared/types'

export interface RecommendationPack {
  id: string
  labelKey: string
  descKey: string
  icon: string
  entries: Array<Omit<HostsEntry, 'id'>>
}

const BLOCK_IP = '0.0.0.0'

export const RECOMMENDATION_PACKS: RecommendationPack[] = [
  {
    id: 'trackers',
    labelKey: 'packTrackers',
    descKey: 'packTrackersDesc',
    icon: 'Eye',
    entries: [
      { ip: BLOCK_IP, hostname: 'google-analytics.com', comment: '# Google Analytics', enabled: true },
      { ip: BLOCK_IP, hostname: 'ssl.google-analytics.com', comment: '# Google Analytics SSL', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.google-analytics.com', comment: '# Google Analytics WWW', enabled: true },
      { ip: BLOCK_IP, hostname: 'stats.g.doubleclick.net', comment: '# DoubleClick Stats', enabled: true },
      { ip: BLOCK_IP, hostname: 'connect.facebook.net', comment: '# Facebook Connect', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.facebook.com', comment: '# Facebook', enabled: true },
      { ip: BLOCK_IP, hostname: 'pixel.facebook.com', comment: '# Facebook Pixel', enabled: true },
      { ip: BLOCK_IP, hostname: 'analytics.twitter.com', comment: '# Twitter Analytics', enabled: true },
      { ip: BLOCK_IP, hostname: 'ads.linkedin.com', comment: '# LinkedIn Ads', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.linkedin.com', comment: '# LinkedIn', enabled: true },
      { ip: BLOCK_IP, hostname: 'hotjar.com', comment: '# Hotjar', enabled: true },
      { ip: BLOCK_IP, hostname: 'static.hotjar.com', comment: '# Hotjar Static', enabled: true },
      { ip: BLOCK_IP, hostname: 'script.hotjar.com', comment: '# Hotjar Script', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.googletagmanager.com', comment: '# Google Tag Manager', enabled: true },
      { ip: BLOCK_IP, hostname: 'mc.yandex.ru', comment: '# Yandex Metrica', enabled: true },
    ],
  },
  {
    id: 'ads',
    labelKey: 'packAds',
    descKey: 'packAdsDesc',
    icon: 'Ban',
    entries: [
      { ip: BLOCK_IP, hostname: 'doubleclick.net', comment: '# DoubleClick', enabled: true },
      { ip: BLOCK_IP, hostname: 'ad.doubleclick.net', comment: '# DoubleClick Ads', enabled: true },
      { ip: BLOCK_IP, hostname: 'adservice.google.com', comment: '# Google AdService', enabled: true },
      { ip: BLOCK_IP, hostname: 'pagead2.googlesyndication.com', comment: '# Google Ads', enabled: true },
      { ip: BLOCK_IP, hostname: 'googleads.g.doubleclick.net', comment: '# Google Ads DCLK', enabled: true },
      { ip: BLOCK_IP, hostname: 'pubads.g.doubleclick.net', comment: '# DoubleClick PubAds', enabled: true },
      { ip: BLOCK_IP, hostname: 'adserver.adtech.de', comment: '# AdTech', enabled: true },
      { ip: BLOCK_IP, hostname: 'ads.yahoo.com', comment: '# Yahoo Ads', enabled: true },
      { ip: BLOCK_IP, hostname: 'ads.yimg.com', comment: '# Yahoo Ads CDN', enabled: true },
      { ip: BLOCK_IP, hostname: 'adserver.yahoo.com', comment: '# Yahoo AdServer', enabled: true },
      { ip: BLOCK_IP, hostname: 'advertising.com', comment: '# Advertising.com', enabled: true },
      { ip: BLOCK_IP, hostname: 'adsafeprotected.com', comment: '# Adsafe', enabled: true },
      { ip: BLOCK_IP, hostname: 'cdn.taboola.com', comment: '# Taboola', enabled: true },
      { ip: BLOCK_IP, hostname: 'outbrain.com', comment: '# Outbrain', enabled: true },
      { ip: BLOCK_IP, hostname: 'amplitude.com', comment: '# Amplitude', enabled: true },
    ],
  },
  {
    id: 'telemetry',
    labelKey: 'packTelemetry',
    descKey: 'packTelemetryDesc',
    icon: 'Radio',
    entries: [
      { ip: BLOCK_IP, hostname: 'vortex.data.microsoft.com', comment: '# MS Telemetry', enabled: true },
      { ip: BLOCK_IP, hostname: 'vortex-win.data.microsoft.com', comment: '# MS Win Telemetry', enabled: true },
      { ip: BLOCK_IP, hostname: 'telecommand.telemetry.microsoft.com', comment: '# MS Telecommand', enabled: true },
      { ip: BLOCK_IP, hostname: 'telemetry.microsoft.com', comment: '# MS Telemetry', enabled: true },
      { ip: BLOCK_IP, hostname: 'watson.telemetry.microsoft.com', comment: '# MS Watson', enabled: true },
      { ip: BLOCK_IP, hostname: 'watson.microsoft.com', comment: '# MS Watson', enabled: true },
      { ip: BLOCK_IP, hostname: 'oca.telemetry.microsoft.com', comment: '# MS OCA', enabled: true },
      { ip: BLOCK_IP, hostname: 'settings-win.data.microsoft.com', comment: '# MS Settings', enabled: true },
      { ip: BLOCK_IP, hostname: 'settings.data.microsoft.com', comment: '# MS Settings', enabled: true },
      { ip: BLOCK_IP, hostname: 'sqm.telemetry.microsoft.com', comment: '# MS SQM', enabled: true },
      { ip: BLOCK_IP, hostname: 'diagnostics.office.com', comment: '# Office Telemetry', enabled: true },
      { ip: BLOCK_IP, hostname: 'officeclient.microsoft.com', comment: '# Office Client', enabled: true },
      { ip: BLOCK_IP, hostname: 'browser.events.data.microsoft.com', comment: '# Edge Telemetry', enabled: true },
      { ip: BLOCK_IP, hostname: 'data.microsoft.com', comment: '# MS Data', enabled: true },
    ],
  },
  {
    id: 'malware',
    labelKey: 'packMalware',
    descKey: 'packMalwareDesc',
    icon: 'Shield',
    entries: [
      { ip: BLOCK_IP, hostname: 'malware-test.com', comment: '# Malware test domain', enabled: true },
      { ip: BLOCK_IP, hostname: 'phishing-test.com', comment: '# Phishing test', enabled: true },
      { ip: BLOCK_IP, hostname: 'spam-domain.com', comment: '# Spam domain', enabled: true },
      { ip: BLOCK_IP, hostname: 'ransomware-tracker.example.com', comment: '# Ransomware tracker', enabled: true },
      { ip: BLOCK_IP, hostname: 'c2-server.example.com', comment: '# C2 server', enabled: true },
      { ip: BLOCK_IP, hostname: 'cryptominer.example.com', comment: '# Cryptominer', enabled: true },
    ],
  },
  {
    id: 'porn',
    labelKey: 'packPorn',
    descKey: 'packPornDesc',
    icon: 'Lock',
    entries: [
      { ip: BLOCK_IP, hostname: 'pornhub.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.pornhub.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'xvideos.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.xvideos.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'xhamster.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.xhamster.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'redtube.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.redtube.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'youporn.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.youporn.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'tube8.com', comment: '# Adult content', enabled: true },
      { ip: BLOCK_IP, hostname: 'www.tube8.com', comment: '# Adult content', enabled: true },
    ],
  },
]
