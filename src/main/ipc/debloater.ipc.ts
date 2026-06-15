import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import type { BloatwareApp } from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync, psArgs } from '../services/exec-utf8'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

// Known bloatware packages with metadata
export const KNOWN_BLOATWARE: Omit<BloatwareApp, 'id' | 'size' | 'selected'>[] = [
  // Microsoft apps
  {
    name: '3D Viewer',
    packageName: 'Microsoft.Microsoft3DViewer',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: '3D model viewer — rarely used by most users',
  },
  {
    name: 'Bing News',
    packageName: 'Microsoft.BingNews',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'News aggregator with ads',
  },
  {
    name: 'Bing Weather',
    packageName: 'Microsoft.BingWeather',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Weather app with ads',
  },
  {
    name: 'Clipchamp',
    packageName: 'Clipchamp.Clipchamp',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Video editor — promotes paid subscription',
  },
  {
    name: 'Cortana',
    packageName: 'Microsoft.549981C3F5F10',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Voice assistant — uses background resources',
  },
  {
    name: 'Feedback Hub',
    packageName: 'Microsoft.WindowsFeedbackHub',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Feedback submission tool for Windows Insiders',
  },
  {
    name: 'Get Help',
    packageName: 'Microsoft.GetHelp',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Windows help app — links to online support',
  },
  {
    name: 'Mail and Calendar',
    packageName: 'microsoft.windowscommunicationsapps',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'Built-in mail/calendar — most users prefer Outlook or webmail',
  },
  {
    name: 'Maps',
    packageName: 'Microsoft.WindowsMaps',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Windows Maps — most users prefer Google Maps in browser',
  },
  {
    name: 'Microsoft News',
    packageName: 'Microsoft.News',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'News feed with ads and tracking',
  },
  {
    name: 'Microsoft Solitaire',
    packageName: 'Microsoft.MicrosoftSolitaireCollection',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Solitaire with ads and Xbox integration',
  },
  {
    name: 'Microsoft Tips',
    packageName: 'Microsoft.Getstarted',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Tips app — promotional content for Microsoft services',
  },
  {
    name: 'Microsoft To Do',
    packageName: 'Microsoft.Todos',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Task management — redundant if using other tools',
  },
  {
    name: 'Mixed Reality Portal',
    packageName: 'Microsoft.MixedReality.Portal',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'VR/AR portal — unnecessary without VR headset',
  },
  {
    name: 'Movies & TV',
    packageName: 'Microsoft.ZuneVideo',
    publisher: 'Microsoft',
    category: 'media',
    description: 'Video player — most users prefer VLC or MPC',
  },
  {
    name: 'Office Hub',
    packageName: 'Microsoft.MicrosoftOfficeHub',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Office promotion hub — not the actual Office suite',
  },
  {
    name: 'OneNote for Windows',
    packageName: 'Microsoft.Office.OneNote',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'OneNote UWP app — desktop version is separate',
  },
  {
    name: 'Outlook (new)',
    packageName: 'Microsoft.OutlookForWindows',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'New Outlook app — replaces Mail, uses web version',
  },
  {
    name: 'Paint',
    packageName: 'Microsoft.MSPaint',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Windows Paint app — remove only if you use a different image editor',
  },
  {
    name: 'People',
    packageName: 'Microsoft.People',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'Contact aggregator — syncs with Microsoft account',
  },
  {
    name: 'Phone Link',
    packageName: 'Microsoft.YourPhone',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'Phone-to-PC app — runs background services',
  },
  {
    name: 'Power Automate',
    packageName: 'Microsoft.PowerAutomateDesktop',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Desktop automation tool — enterprise feature',
  },
  {
    name: 'Quick Assist',
    packageName: 'MicrosoftCorporationII.QuickAssist',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Remote assistance tool',
  },
  {
    name: 'Skype',
    packageName: 'Microsoft.SkypeApp',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'Skype UWP — most users prefer Teams or Discord',
  },
  {
    name: 'Sticky Notes',
    packageName: 'Microsoft.MicrosoftStickyNotes',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Sticky notes — syncs with Microsoft account',
  },
  {
    name: 'Teams (personal)',
    packageName: 'MSTeams',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'Teams personal edition — auto-starts and runs in background',
  },
  {
    name: 'Voice Recorder',
    packageName: 'Microsoft.WindowsSoundRecorder',
    publisher: 'Microsoft',
    category: 'media',
    description: 'Simple voice recorder',
  },
  {
    name: 'Widgets',
    packageName: 'MicrosoftWindows.Client.WebExperience',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Taskbar widgets — uses Edge WebView and background resources',
  },
  {
    name: 'Xbox App',
    packageName: 'Microsoft.XboxApp',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Xbox companion app',
  },
  {
    name: 'Xbox Game Bar',
    packageName: 'Microsoft.XboxGamingOverlay',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Game overlay — adds input latency',
  },
  {
    name: 'Xbox Speech to Text',
    packageName: 'Microsoft.XboxSpeechToTextOverlay',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Xbox accessibility overlay',
  },
  {
    name: 'Groove Music',
    packageName: 'Microsoft.ZuneMusic',
    publisher: 'Microsoft',
    category: 'media',
    description: 'Music player — deprecated, replaced by Media Player',
  },
  {
    name: 'Bing Search',
    packageName: 'Microsoft.BingSearch',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Bing search integration — web searches from taskbar',
  },
  {
    name: 'Xbox (Gaming App)',
    packageName: 'Microsoft.GamingApp',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Xbox PC app for game library and social features',
  },
  {
    name: 'Edge Game Assist',
    packageName: 'Microsoft.Edge.GameAssist',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Edge game overlay assistant',
  },
  {
    name: 'Copilot',
    packageName: 'Microsoft.Copilot',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'AI assistant — runs background services and collects data',
  },
  {
    name: 'Microsoft Journal',
    packageName: 'Microsoft.MicrosoftJournal',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Digital journal app — rarely used',
  },
  {
    name: 'Dev Home',
    packageName: 'Microsoft.Windows.DevHome',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Developer setup tool — unnecessary for most users',
  },
  {
    name: 'Paint 3D',
    packageName: 'Microsoft.MSPaint3D',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: '3D painting app — deprecated by Microsoft',
  },
  {
    name: 'Print 3D',
    packageName: 'Microsoft.Print3D',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: '3D printing app — rarely used',
  },
  {
    name: 'Power BI',
    packageName: 'Microsoft.MicrosoftPowerBIForWindows',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Business analytics — enterprise feature',
  },
  {
    name: 'Sway',
    packageName: 'Microsoft.Office.Sway',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Presentation creator — web-based alternative exists',
  },
  {
    name: 'One Connect',
    packageName: 'Microsoft.OneConnect',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Mobile plan management app',
  },
  {
    name: 'Microsoft 365 Companions',
    packageName: 'Microsoft.Microsoft365Companions',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Microsoft 365 promotional companion app',
  },
  {
    name: 'Network Speed Test',
    packageName: 'Microsoft.NetworkSpeedTest',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Speed test — web alternatives available',
  },
  {
    name: 'Remote Desktop',
    packageName: 'Microsoft.RemoteDesktop',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Remote desktop UWP client',
  },
  {
    name: 'Xbox Identity Provider',
    packageName: 'Microsoft.XboxIdentityProvider',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Xbox sign-in framework — only needed for Xbox games',
  },
  {
    name: 'Xbox TCUI',
    packageName: 'Microsoft.Xbox.TCUI',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Xbox UI framework — only needed for Xbox games',
  },
  {
    name: 'Alarms & Clock',
    packageName: 'Microsoft.WindowsAlarms',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Alarms and timer app — remove if not needed',
  },
  {
    name: 'PC Manager',
    packageName: 'Microsoft.MicrosoftPCManager',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Ferramenta de otimização — redundante com o DiNho Optimizer',
  },
  {
    name: 'Copilot+ AI Hub',
    packageName: 'Microsoft.Windows.Ai.Copilot.Provider',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'AI hub for Copilot+ PCs — background AI services',
  },
  {
    name: 'Family Safety',
    packageName: 'MicrosoftCorporationII.MicrosoftFamily',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Family safety and parental controls',
  },

  // OEM bloatware
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

  // Common pre-installed apps
  {
    name: 'Disney+',
    packageName: 'Disney.37853FC22B2CE',
    publisher: 'Disney',
    category: 'media',
    description: 'Streaming app — pre-installed promotion',
  },
  {
    name: 'Spotify',
    packageName: 'SpotifyAB.SpotifyMusic',
    publisher: 'Spotify',
    category: 'media',
    description: 'Music streaming — pre-installed promotion',
  },
  {
    name: 'TikTok',
    packageName: 'BytedancePte.Ltd.TikTok',
    publisher: 'ByteDance',
    category: 'media',
    description: 'Social media — pre-installed promotion',
  },
  {
    name: 'Instagram',
    packageName: 'Facebook.InstagramBeta',
    publisher: 'Meta',
    category: 'communication',
    description: 'Social media — pre-installed promotion',
  },
  {
    name: 'Facebook',
    packageName: 'Facebook.Facebook',
    publisher: 'Meta',
    category: 'communication',
    description: 'Social media — pre-installed promotion',
  },
  {
    name: 'Candy Crush Saga',
    packageName: 'king.com.CandyCrushSaga',
    publisher: 'King',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Candy Crush Friends',
    packageName: 'king.com.CandyCrushFriends',
    publisher: 'King',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Bubble Witch 3',
    packageName: 'king.com.BubbleWitch3Saga',
    publisher: 'King',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'March of Empires',
    packageName: 'Gameloft.MarchofEmpires',
    publisher: 'Gameloft',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Asphalt 8',
    packageName: 'Gameloft.Asphalt8Airborne',
    publisher: 'Gameloft',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Caesars Slots',
    packageName: 'PlaytikaSantaMonica.CaesarsSlotsFreeCasino',
    publisher: 'Playtika',
    category: 'gaming',
    description: 'Pre-installed casino game',
  },
  {
    name: 'Cooking Fever',
    packageName: 'JEGOROVVLADIMIR.46390A297A2C4',
    publisher: 'Nordcurrent',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Disney Magic Kingdoms',
    packageName: 'GameloftSA.DisneyMagicKingdoms',
    publisher: 'Gameloft',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'FarmVille 2',
    packageName: 'Zynga.FarmVille2CountryEscape',
    publisher: 'Zynga',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Hidden City',
    packageName: 'G5Entertainment.HiddenCity',
    publisher: 'G5',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Royal Revolt',
    packageName: 'flaaboronlineGmbH.RoyalRevolt2',
    publisher: 'flaregames',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },

  // Third-party promoted apps
  {
    name: 'Netflix',
    packageName: '4DF9E0F8.Netflix',
    publisher: 'Netflix',
    category: 'media',
    description: 'Streaming app — pre-installed promotion',
  },
  {
    name: 'Amazon Prime Video',
    packageName: 'AmazonVideo.PrimeVideo',
    publisher: 'Amazon',
    category: 'media',
    description: 'Streaming app — pre-installed promotion',
  },
  {
    name: 'Hulu',
    packageName: 'HuluLLC.HuluPlus',
    publisher: 'Hulu',
    category: 'media',
    description: 'Streaming app — pre-installed promotion',
  },
  {
    name: 'LinkedIn',
    packageName: '7EE7776C.LinkedInforWindows',
    publisher: 'LinkedIn',
    category: 'communication',
    description: 'Social media — pre-installed promotion',
  },
  {
    name: 'Twitter',
    packageName: '9E2F88E3.Twitter',
    publisher: 'X Corp',
    category: 'communication',
    description: 'Social media — pre-installed promotion',
  },
  {
    name: 'Viber',
    packageName: 'Viber.Viber',
    publisher: 'Viber',
    category: 'communication',
    description: 'Messaging app — pre-installed promotion',
  },
  {
    name: 'Pandora',
    packageName: 'PandoraMediaInc.29680B314EFC2',
    publisher: 'Pandora',
    category: 'media',
    description: 'Music streaming — pre-installed promotion',
  },
  {
    name: 'iHeartRadio',
    packageName: 'ClearChannelRadioDigital.iHeartRadio',
    publisher: 'iHeartMedia',
    category: 'media',
    description: 'Radio streaming — pre-installed promotion',
  },
  {
    name: 'TuneIn Radio',
    packageName: 'TuneIn.TuneInRadio',
    publisher: 'TuneIn',
    category: 'media',
    description: 'Radio streaming — pre-installed promotion',
  },
  {
    name: 'Plex',
    packageName: 'CAF9E577.Plex',
    publisher: 'Plex',
    category: 'media',
    description: 'Media server client — pre-installed promotion',
  },
  {
    name: 'Sling TV',
    packageName: 'SlingTV.SlingTV',
    publisher: 'Sling TV',
    category: 'media',
    description: 'Live TV streaming — pre-installed promotion',
  },
  {
    name: 'Shazam',
    packageName: 'ShazamEntertainmentLtd.Shazam',
    publisher: 'Apple',
    category: 'media',
    description: 'Music recognition — pre-installed promotion',
  },
  {
    name: 'Duolingo',
    packageName: 'D5EA27B7.Duolingo-LearnLanguagesforFree',
    publisher: 'Duolingo',
    category: 'utility',
    description: 'Language learning — pre-installed promotion',
  },
  {
    name: 'Flipboard',
    packageName: 'Flipboard.Flipboard',
    publisher: 'Flipboard',
    category: 'media',
    description: 'News aggregator — pre-installed promotion',
  },
  {
    name: 'Adobe Photoshop Express',
    packageName: 'AdobeSystemsIncorporated.AdobePhotoshopExpress',
    publisher: 'Adobe',
    category: 'utility',
    description: 'Photo editor — pre-installed promotion',
  },
  {
    name: 'Autodesk SketchBook',
    packageName: 'AutodeskSketchBook.SketchBook',
    publisher: 'Autodesk',
    category: 'utility',
    description: 'Drawing app — pre-installed promotion',
  },
  {
    name: 'Drawboard PDF',
    packageName: 'Drawboard.DrawboardPDF',
    publisher: 'Drawboard',
    category: 'utility',
    description: 'PDF editor — pre-installed promotion',
  },
  {
    name: 'Fitbit',
    packageName: 'Fitbit.FitbitCoach',
    publisher: 'Fitbit',
    category: 'utility',
    description: 'Fitness tracker — pre-installed promotion',
  },
  {
    name: 'PicsArt',
    packageName: 'PicsArt-PhotoStudio.PicsArt-PhotoStudio',
    publisher: 'PicsArt',
    category: 'utility',
    description: 'Photo editor — pre-installed promotion',
  },
  {
    name: 'Amazon',
    packageName: 'AmazonMobileLLC.AmazonShopping',
    publisher: 'Amazon',
    category: 'utility',
    description: 'Shopping app — pre-installed promotion',
  },
  {
    name: 'WinZip',
    packageName: 'WinZipComputing.WinZipUniversal',
    publisher: 'WinZip',
    category: 'utility',
    description: 'Archive tool — free alternatives available',
  },

  // Additional OEM bloatware
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
  {
    name: 'Dell Mobile Connect',
    packageName: 'DellInc.DellMobileConnect',
    publisher: 'Dell',
    category: 'oem',
    description: 'Dell phone integration — runs background services',
  },
  {
    name: 'Lenovo Vantage Service',
    packageName: 'E046963F.LenovoSettingsforEnterprise',
    publisher: 'Lenovo',
    category: 'oem',
    description: 'Lenovo enterprise settings service',
  },

  // More Microsoft apps
  {
    name: 'Microsoft Whiteboard',
    packageName: 'Microsoft.Whiteboard',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Digital canvas for team collaboration — rarely used solo',
  },
  {
    name: 'Windows Camera',
    packageName: 'Microsoft.WindowsCamera',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'Built-in webcam app — remove if using third-party camera',
  },
  {
    name: 'Windows Photos',
    packageName: 'Microsoft.Windows.Photos',
    publisher: 'Microsoft',
    category: 'media',
    description: 'Photo viewer/editor — many users prefer alternatives',
  },
  {
    name: 'Steps Recorder',
    packageName: 'Microsoft.StepsRecorder',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Troubleshooting step recorder — rarely needed',
  },
  {
    name: 'Microsoft Wallet',
    packageName: 'Microsoft.Wallet',
    publisher: 'Microsoft',
    category: 'utility',
    description: 'Digital wallet — US-only, unnecessary elsewhere',
  },
  {
    name: 'Microsoft Messaging',
    packageName: 'Microsoft.Messaging',
    publisher: 'Microsoft',
    category: 'communication',
    description: 'SMS messaging app — requires Phone Link to function',
  },
  {
    name: 'Microsoft Mahjong',
    packageName: 'Microsoft.MicrosoftMahjong',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Mahjong game with ads and microtransactions',
  },
  {
    name: 'Microsoft Minesweeper',
    packageName: 'Microsoft.MicrosoftMinesweeper',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Minesweeper game with ads and Xbox Live integration',
  },
  {
    name: 'Microsoft Sudoku',
    packageName: 'Microsoft.MicrosoftSudoku',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Sudoku game with ads and daily challenges',
  },
  {
    name: 'Microsoft Jigsaw',
    packageName: 'Microsoft.MicrosoftJigsaw',
    publisher: 'Microsoft',
    category: 'gaming',
    description: 'Jigsaw puzzle game with ad-supported content',
  },
  {
    name: 'Windows Recall',
    packageName: 'Microsoft.Windows.Recall',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'AI timeline snapshots — privacy concerns, Copilot+ PCs only',
  },
  {
    name: 'Windows Studio Effects',
    packageName: 'Microsoft.Windows.StudioEffects',
    publisher: 'Microsoft',
    category: 'microsoft',
    description: 'AI camera/audio effects — Copilot+ PC NPU feature',
  },

  // ASUS bloatware
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

  // Samsung bloatware
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

  // Acer bloatware
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

  // MSI bloatware
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

  // Additional OEM/chipset bloatware
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

  // More pre-installed third-party apps
  {
    name: 'Angry Birds 2',
    packageName: 'RovioEntertainmentLtd.AngryBirds2',
    publisher: 'Rovio',
    category: 'gaming',
    description: 'Pre-installed game with microtransactions',
  },
  {
    name: 'Township',
    packageName: 'PlayrixTownship.Township',
    publisher: 'Playrix',
    category: 'gaming',
    description: 'Pre-installed city-building game with microtransactions',
  },
  {
    name: 'Gardenscapes',
    packageName: 'PlayrixGardenscapes.Gardenscapes',
    publisher: 'Playrix',
    category: 'gaming',
    description: 'Pre-installed puzzle game with microtransactions',
  },
  {
    name: 'Royal Match',
    packageName: 'Dream3D.RoyalMatch',
    publisher: 'Dream3D',
    category: 'gaming',
    description: 'Pre-installed puzzle game with microtransactions',
  },
  {
    name: 'World of Tanks Blitz',
    packageName: 'Wargaming.Net.WorldOfTanksBlitz',
    publisher: 'Wargaming',
    category: 'gaming',
    description: 'Pre-installed tank game with microtransactions',
  },
  {
    name: 'Crossout',
    packageName: 'TargemGames.Crossout',
    publisher: 'Targem',
    category: 'gaming',
    description: 'Pre-installed vehicle combat game',
  },
  {
    name: 'Pinterest',
    packageName: 'Pinterest.Pinterest',
    publisher: 'Pinterest',
    category: 'communication',
    description: 'Visual discovery platform — pre-installed promotion',
  },
  {
    name: 'Kahoot!',
    packageName: 'Kahoot.Kahoot',
    publisher: 'Kahoot',
    category: 'utility',
    description: 'Quiz platform — pre-installed promotion',
  },
  {
    name: 'Khan Academy',
    packageName: 'KhanAcademy.KhanAcademy',
    publisher: 'Khan Academy',
    category: 'utility',
    description: 'Educational videos — pre-installed promotion',
  },
  {
    name: 'Grammarly',
    packageName: 'Grammarly.Grammarly',
    publisher: 'Grammarly',
    category: 'utility',
    description: 'Writing assistant — pre-installed promotion',
  },
  {
    name: 'WPS Office',
    packageName: 'KingsoftOffice.WPSOffice',
    publisher: 'Kingsoft',
    category: 'utility',
    description: 'Office suite — pre-installed promotion, free version has ads',
  },
  {
    name: 'Booking.com',
    packageName: 'Booking.Booking',
    publisher: 'Booking Holdings',
    category: 'utility',
    description: 'Travel booking — pre-installed promotion',
  },
  {
    name: 'Tripadvisor',
    packageName: 'Tripadvisor.Tripadvisor',
    publisher: 'Tripadvisor',
    category: 'utility',
    description: 'Travel reviews — pre-installed promotion',
  },
]

// ── Win32 uninstall cache (populated during scan, consumed during removal) ──

const win32UninstallCommands = new Map<string, { type: 'msi' | 'exe'; command: string }>()

/** Clears cached Win32 uninstall commands — exported for testing */
export function clearWin32Cache(): void {
  win32UninstallCommands.clear()
}

// ── Exported core logic ──

export async function scanBloatware(): Promise<BloatwareApp[]> {
  const logger = getLogger()
  const apps: BloatwareApp[] = []
  const foundBloatwareKeys = new Set<string>()
  win32UninstallCommands.clear()
  logger.info('debloater', 'Scanning for bloatware...')

  try {
    const appxScript = `Get-AppxPackage | ForEach-Object {
        $size = 0
        if ($_.InstallLocation -and (Test-Path $_.InstallLocation)) {
          $size = (Get-ChildItem -Path $_.InstallLocation -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
          if (-not $size) { $size = 0 }
        }
        [PSCustomObject]@{ Name = $_.Name; PackageFullName = $_.PackageFullName; InstallLocation = $_.InstallLocation; Size = $size }
      } | ConvertTo-Json -Compress`
    const { stdout } = await execFileAsync('powershell', psArgs(appxScript), { timeout: 60000, windowsHide: true })

    let installedPackages: { Name: string; PackageFullName: string; InstallLocation: string; Size: number }[] = []
    try {
      const parsed = JSON.parse(stdout)
      installedPackages = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      installedPackages = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      const matchedPkg = installedPackages.find(
        (p) => p.Name === bloatware.packageName || p.Name.startsWith(`${bloatware.packageName}.`),
      )

      if (matchedPkg) {
        foundBloatwareKeys.add(bloatware.packageName)

        let sizeStr = 'Unknown'
        const bytes = matchedPkg.Size || 0
        if (bytes > 0) {
          if (bytes > 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
          else if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          else if (bytes > 1024) sizeStr = `${(bytes / 1024).toFixed(0)} KB`
          else sizeStr = `${bytes} B`
        }

        apps.push({
          id: randomUUID(),
          name: bloatware.name,
          packageName: matchedPkg.Name,
          publisher: bloatware.publisher,
          category: bloatware.category,
          description: bloatware.description,
          size: sizeStr,
          selected: false,
        })
      }
    }
  } catch {
    // Phase 1 failed — continue to provisioned scan
  }

  // Phase 2: Scan provisioned AppX packages (staged for new users)
  try {
    const provScript = `Get-AppxProvisionedPackage -Online | Select-Object @{N='Name';E={$_.DisplayName}} | ConvertTo-Json -Compress`
    const { stdout: provStdout } = await execFileAsync('powershell', psArgs(provScript), {
      timeout: 30000,
      windowsHide: true,
    })

    let provisionedPackages: { Name: string }[] = []
    try {
      const parsed = JSON.parse(provStdout)
      provisionedPackages = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      provisionedPackages = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      if (foundBloatwareKeys.has(bloatware.packageName)) continue

      const matchedPkg = provisionedPackages.find(
        (p) => p.Name === bloatware.packageName || p.Name.startsWith(`${bloatware.packageName}.`),
      )

      if (matchedPkg) {
        foundBloatwareKeys.add(bloatware.packageName)

        apps.push({
          id: randomUUID(),
          name: bloatware.name,
          packageName: matchedPkg.Name,
          publisher: bloatware.publisher,
          category: bloatware.category,
          description: bloatware.description,
          size: 'Provisioned',
          selected: false,
        })
      }
    }
  } catch {
    // Phase 2 failed — return what we have
  }

  // Phase 3: Scan Win32 classic programs via registry
  try {
    const win32Script = `$paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      ); $paths | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName } | Select-Object DisplayName, Publisher, EstimatedSize, UninstallString, QuietUninstallString, ProductCode | ConvertTo-Json -Compress`
    const { stdout: win32Stdout } = await execFileAsync('powershell', psArgs(win32Script), {
      timeout: 30000,
      windowsHide: true,
    })

    let win32Apps: {
      DisplayName: string
      Publisher: string
      EstimatedSize: number
      UninstallString: string
      QuietUninstallString: string
      ProductCode: string
    }[] = []
    try {
      const parsed = JSON.parse(win32Stdout)
      win32Apps = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      win32Apps = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      if (foundBloatwareKeys.has(bloatware.packageName)) continue

      const nameLower = bloatware.name.toLowerCase()
      const pkgNameLower = bloatware.packageName.toLowerCase()

      const matched = win32Apps.find((app) => {
        const dn = (app.DisplayName || '').toLowerCase()
        return dn.includes(nameLower) || dn.includes(pkgNameLower)
      })

      if (!matched) continue

      foundBloatwareKeys.add(bloatware.packageName)

      // Cache uninstall info for removal
      if (matched.QuietUninstallString) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'exe', command: matched.QuietUninstallString })
      } else if (matched.UninstallString) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'exe', command: matched.UninstallString })
      }
      if (matched.ProductCode) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'msi', command: matched.ProductCode })
      }

      let sizeStr = 'Win32'
      const estKB = matched.EstimatedSize || 0
      if (estKB > 0) {
        const bytes = estKB * 1024
        if (bytes > 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        else if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        else if (bytes > 1024) sizeStr = `${(bytes / 1024).toFixed(0)} KB`
        else sizeStr = `${bytes} B`
      }

      apps.push({
        id: randomUUID(),
        name: bloatware.name,
        packageName: bloatware.packageName,
        publisher: bloatware.publisher,
        category: bloatware.category,
        description: bloatware.description,
        size: sizeStr,
        selected: false,
      })
    }
  } catch {
    // Phase 3 failed — return what we have
  }

  getLogger().success('debloater', `Scan complete — found ${apps.length} bloatware apps`)
  return apps
}

export async function removeBloatware(
  packageNames: string[],
  onProgress?: (current: number, total: number, currentApp: string, status: 'removing' | 'done' | 'failed') => void,
): Promise<{ removed: number; failed: number }> {
  const logger = getLogger()
  const knownNames = new Set(KNOWN_BLOATWARE.map((b) => b.packageName))
  logger.info('debloater', `Removing ${packageNames.length} bloatware app(s)...`)
  const validNames = packageNames.filter((name) => typeof name === 'string' && knownNames.has(name))

  let removed = 0
  let failed = 0

  for (let i = 0; i < validNames.length; i++) {
    const pkgName = validNames[i]!
    const safeName = pkgName.replace(/'/g, "''")
    onProgress?.(i + 1, validNames.length, pkgName, 'removing')

    const win32Cmd = win32UninstallCommands.get(pkgName)
    if (win32Cmd) {
      try {
        if (win32Cmd.type === 'msi') {
          await execFileAsync('msiexec', ['/x', win32Cmd.command, '/quiet', '/norestart'], {
            timeout: 60000,
            windowsHide: true,
          })
        } else {
          await execFileAsync('cmd.exe', ['/c', win32Cmd.command], { timeout: 60000, windowsHide: true })
        }
        removed++
        onProgress?.(i + 1, validNames.length, pkgName, 'done')
      } catch {
        failed++
        onProgress?.(i + 1, validNames.length, pkgName, 'failed')
      }
      continue
    }

    // AppX removal path
    try {
      await execFileAsync(
        'powershell',
        psArgs(`Get-AppxPackage '${safeName}' | Remove-AppxPackage -ErrorAction Stop`),
        { timeout: 30000, windowsHide: true },
      )
      removed++
      onProgress?.(i + 1, validNames.length, pkgName, 'done')

      try {
        await execFileAsync(
          'powershell',
          psArgs(
            `Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq '${safeName}' } | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue`,
          ),
          { timeout: 15000, windowsHide: true },
        )
      } catch {
        // Deprovisioning failed (needs admin) — not critical
      }
    } catch {
      failed++
      onProgress?.(i + 1, validNames.length, pkgName, 'failed')
    }
  }

  logger.info('debloater', `Removal finished — ${removed} succeeded, ${failed} failed`)
  return { removed, failed }
}

// ── IPC registration ──

export function registerDebloaterIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DEBLOATER_SCAN, () => {
    if (process.platform !== 'win32') return []
    return scanBloatware()
  })

  ipcMain.handle(
    IPC.DEBLOATER_REMOVE,
    async (_event, packageNames: string[]): Promise<{ removed: number; failed: number }> => {
      if (process.platform !== 'win32') return { removed: 0, failed: 0 }
      const valid = validateStringArray(packageNames, 500)
      if (!valid) return { removed: 0, failed: 0 }
      return removeBloatware(valid, (current, total, currentApp, status) => {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send(IPC.DEBLOATER_REMOVE_PROGRESS, { current, total, currentApp, status })
      })
    },
  )
}
