import type { BloatwareApp } from '@shared/types'

export const OEM_BLOATWARE: Omit<BloatwareApp, 'id' | 'size' | 'selected'>[] = [
  // Dell
  {
    name: 'Dell SupportAssist',
    packageName: 'DellInc.DellSupportAssistforPCs',
    publisher: 'Dell',
    category: 'oem',
    description: 'Dell support tool — heavy on resources and notifications',
  },
  {
    name: 'Dell Digital Delivery',
    packageName: 'DellInc.DellDigitalDelivery',
    publisher: 'Dell',
    category: 'oem',
    description: 'Dell software delivery service',
  },
  {
    name: 'Dell Command Update',
    packageName: 'DellInc.DellCommandUpdate',
    publisher: 'Dell',
    category: 'oem',
    description: 'Dell driver/BIOS updater',
  },
  {
    name: 'Dell Mobile Connect',
    packageName: 'DellInc.DellMobileConnect',
    publisher: 'Dell',
    category: 'oem',
    description: 'Dell phone integration — runs background services',
  },

  // HP
  {
    name: 'HP Smart',
    packageName: 'AD2F1837.HPPrinterControl',
    publisher: 'HP',
    category: 'oem',
    description: 'HP printer management — unnecessary without HP printer',
  },
  {
    name: 'HP Wolf Security',
    packageName: 'AD2F1837.HPWolfSecurity',
    publisher: 'HP',
    category: 'oem',
    description: 'HP security suite — redundant with Windows Defender',
  },
  {
    name: 'HP Desktop Support',
    packageName: 'AD2F1837.HPDesktopSupportUtilities',
    publisher: 'HP',
    category: 'oem',
    description: 'HP desktop support utilities',
  },
  {
    name: 'HP Quick Drop',
    packageName: 'AD2F1837.HPQuickDrop',
    publisher: 'HP',
    category: 'oem',
    description: 'HP file transfer tool — runs background services',
  },
  {
    name: 'HP System Information',
    packageName: 'AD2F1837.HPSystemInformation',
    publisher: 'HP',
    category: 'oem',
    description: 'HP system info tool — redundant with Windows',
  },
  {
    name: 'HP Privacy Settings',
    packageName: 'AD2F1837.HPPrivacySettings',
    publisher: 'HP',
    category: 'oem',
    description: 'HP privacy configuration tool',
  },
  {
    name: 'HP Support Assistant',
    packageName: 'AD2F1837.HPSupportAssistant',
    publisher: 'HP',
    category: 'oem',
    description: 'HP support tool — heavy on resources and notifications',
  },
  {
    name: 'HP Easy Clean',
    packageName: 'AD2F1837.HPEasyClean',
    publisher: 'HP',
    category: 'oem',
    description: 'HP keyboard lock for cleaning',
  },
  {
    name: 'HP Sure Shield AI',
    packageName: 'AD2F1837.HPSureShieldAI',
    publisher: 'HP',
    category: 'oem',
    description: 'HP AI-based security — redundant with Windows Defender',
  },
  {
    name: 'HP AI Experience Center',
    packageName: 'AD2F1837.HPAIExperienceCenter',
    publisher: 'HP',
    category: 'oem',
    description: 'HP AI features hub',
  },
  {
    name: 'HP WorkWell',
    packageName: 'AD2F1837.HPWorkWell',
    publisher: 'HP',
    category: 'oem',
    description: 'HP wellness and productivity tracker',
  },
  {
    name: 'HP Power Manager',
    packageName: 'AD2F1837.HPPowerManager',
    publisher: 'HP',
    category: 'oem',
    description: 'HP battery management tool',
  },
  {
    name: 'myHP',
    packageName: 'AD2F1837.myHP',
    publisher: 'HP',
    category: 'oem',
    description: 'HP account and device management',
  },

  // Lenovo
  {
    name: 'Lenovo Vantage',
    packageName: 'E046963F.LenovoCompanion',
    publisher: 'Lenovo',
    category: 'oem',
    description: 'Lenovo system management — heavy background services',
  },
  {
    name: 'Lenovo Now',
    packageName: 'E0469640.LenovoUtility',
    publisher: 'Lenovo',
    category: 'oem',
    description: 'Lenovo utility tool',
  },
  {
    name: 'Lenovo Vantage Service',
    packageName: 'E046963F.LenovoSettingsforEnterprise',
    publisher: 'Lenovo',
    category: 'oem',
    description: 'Lenovo enterprise settings service',
  },

  // McAfee / Norton
  {
    name: 'McAfee',
    packageName: 'McAfee',
    publisher: 'McAfee',
    category: 'oem',
    description: 'Pre-installed antivirus — redundant with Windows Defender',
  },
  {
    name: 'Norton',
    packageName: 'Norton',
    publisher: 'NortonLifeLock',
    category: 'oem',
    description: 'Pre-installed antivirus — redundant with Windows Defender',
  },
  {
    name: 'WildTangent Games',
    packageName: 'WildTangentGames',
    publisher: 'WildTangent',
    category: 'oem',
    description: 'Pre-installed game platform — adware-like behavior',
  },

  // ASUS
  {
    name: 'ASUS Giftbox',
    packageName: 'ASUSTeKCOMPUTERINC.ASUSGiftbox',
    publisher: 'ASUS',
    category: 'oem',
    description: 'ASUS promotional app store with offers',
  },
  {
    name: 'ASUS ScreenXpert',
    packageName: 'ASUSTeKCOMPUTERINC.ScreenXpert',
    publisher: 'ASUS',
    category: 'oem',
    description: 'ASUS ScreenPad control center',
  },
  {
    name: 'ASUS GlideX',
    packageName: 'ASUSTeKCOMPUTERINC.GlideX',
    publisher: 'ASUS',
    category: 'oem',
    description: 'ASUS multi-device screen sharing',
  },
  {
    name: 'ASUS Armoury Crate',
    packageName: 'B9F59455.ASUSArmouryCrate',
    publisher: 'ASUS',
    category: 'oem',
    description: 'ASUS gaming peripheral control — background services',
  },

  // Samsung
  {
    name: 'Samsung Settings',
    packageName: 'SamsungElectronics.SamsungSettings',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung system settings control panel',
  },
  {
    name: 'Samsung Update',
    packageName: 'SamsungElectronics.SamsungUpdate',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung driver and software updater',
  },
  {
    name: 'Samsung Flow',
    packageName: 'SamsungElectronics.SamsungFlow',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung device connectivity and screen mirroring',
  },
  {
    name: 'Samsung Notes',
    packageName: 'SamsungElectronics.SamsungNotes',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung note-taking app — pre-installed on Galaxy Books',
  },
  {
    name: 'Samsung Security',
    packageName: 'SamsungElectronics.SamsungSecurity',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung security suite — redundant with Windows Defender',
  },
  {
    name: 'Samsung Internet',
    packageName: 'SamsungInternet.SamsungInternet',
    publisher: 'Samsung',
    category: 'oem',
    description: 'Samsung browser — redundant with Edge or Chrome',
  },

  // Acer
  {
    name: 'Acer Portal',
    packageName: 'AcerIncorporated.AcerPortal',
    publisher: 'Acer',
    category: 'oem',
    description: 'Acer system info and support portal',
  },
  {
    name: 'Acer Collection',
    packageName: 'AcerIncorporated.AcerCollection',
    publisher: 'Acer',
    category: 'oem',
    description: 'Acer recommended app storefront',
  },
  {
    name: 'Acer Jumpstart',
    packageName: 'AcerIncorporated.AcerJumpstart',
    publisher: 'Acer',
    category: 'oem',
    description: 'Acer new device setup and registration',
  },
  {
    name: 'Acer Care Center',
    packageName: 'AcerIncorporated.AcerCareCenter',
    publisher: 'Acer',
    category: 'oem',
    description: 'Acer system diagnostics and warranty checks',
  },

  // MSI
  {
    name: 'MSI Center',
    packageName: 'MSI.MSICenter',
    publisher: 'MSI',
    category: 'oem',
    description: 'MSI system control and monitoring center',
  },
  {
    name: 'MSI Dragon Center',
    packageName: 'MSI.DragonCenter',
    publisher: 'MSI',
    category: 'oem',
    description: 'MSI gaming optimization suite — heavy background services',
  },
  {
    name: 'MSI True Color',
    packageName: 'MSI.TrueColor',
    publisher: 'MSI',
    category: 'oem',
    description: 'MSI display color calibration tool',
  },

  // Chipset
  {
    name: 'Intel Driver & Support Assistant',
    packageName: 'INTELCORPORATION.IntelDriverandSupportAssistant',
    publisher: 'Intel',
    category: 'oem',
    description: 'Intel driver updater — runs background services',
  },
  {
    name: 'Realtek Audio Control',
    packageName: 'RealtekSemiconductorCorp.RealtekAudioControl',
    publisher: 'Realtek',
    category: 'oem',
    description: 'Realtek audio manager — can be replaced by third-party EQ',
  },
]
