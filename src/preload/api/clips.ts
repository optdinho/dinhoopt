import { IPC } from '@shared/channels'
import type {
  AudioSessionInfo,
  ClipInfo,
  ClipMergeResult,
  ClipsConfig,
  ClipsEngineStatus,
  ClipTrimResult,
  MicDeviceInfo,
} from '@shared/types'
import { ipcRenderer } from 'electron'

export const clipsMethods = {
  clipsGetStatus: (): Promise<ClipsEngineStatus> => ipcRenderer.invoke(IPC.CLIPS_GET_STATUS),
  clipsStartEngine: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLIPS_START_ENGINE),
  clipsStopEngine: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLIPS_STOP_ENGINE),
  clipsStartCapture: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLIPS_START_CAPTURE),
  clipsStopCapture: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLIPS_STOP_CAPTURE),
  clipsSaveClip: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLIPS_SAVE_CLIP),
  clipsList: (): Promise<ClipInfo[]> => ipcRenderer.invoke(IPC.CLIPS_LIST_CLIPS),
  clipsGetDurations: (paths: string[]): Promise<Record<string, number>> =>
    ipcRenderer.invoke(IPC.CLIPS_GET_DURATIONS, paths),
  clipsDelete: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_DELETE_CLIP, name),
  clipsRename: (oldName: string, newName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_RENAME_CLIP, oldName, newName),
  clipsOpen: (path: string): Promise<void> => ipcRenderer.invoke(IPC.CLIPS_OPEN_CLIP, path),
  clipsGetConfig: (): Promise<ClipsConfig> => ipcRenderer.invoke(IPC.CLIPS_GET_CONFIG),
  clipsSetConfig: (config: Partial<ClipsConfig>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_SET_CONFIG, config),
  clipsSelectOutputDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.CLIPS_SELECT_OUTPUT_DIR),
  clipsGetThumbnail: (clipName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.CLIPS_GET_THUMBNAIL, clipName),
  clipsGetAudioSessions: (): Promise<AudioSessionInfo[]> => ipcRenderer.invoke(IPC.CLIPS_GET_AUDIO_SESSIONS),
  clipsSetAudioSessions: (sessionPids: number[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_SET_AUDIO_SESSIONS, sessionPids),
  clipsGetMicDevices: (): Promise<MicDeviceInfo[]> => ipcRenderer.invoke(IPC.CLIPS_GET_MIC_DEVICES),
  clipsSetMicDevice: (deviceId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_SET_MIC_DEVICE, deviceId),
  clipsGetGpus: (): Promise<Array<{ index: number; name: string; vendorId: number }>> =>
    ipcRenderer.invoke(IPC.CLIPS_GET_GPUS),
  clipsGetRunningProcesses: (): Promise<Array<{ name: string; pid: number }>> =>
    ipcRenderer.invoke(IPC.CLIPS_GET_RUNNING_PROCESSES),
  clipsSetFavorite: (clipName: string, favorite: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.CLIPS_SET_FAVORITE, clipName, favorite),
  clipsTrimClip: (clipPath: string, startSeconds: number, endSeconds: number): Promise<ClipTrimResult> =>
    ipcRenderer.invoke(IPC.CLIPS_TRIM_CLIP, clipPath, startSeconds, endSeconds),
  clipsMergeClips: (clipPaths: string[]): Promise<ClipMergeResult> =>
    ipcRenderer.invoke(IPC.CLIPS_MERGE_CLIPS, clipPaths),
  clipsGetVideoUrl: (clipPath: string): string => {
    const encoded = encodeURIComponent(clipPath)
    return `clip-video://file?path=${encoded}`
  },
  clipsOnEngineStatus: (callback: (status: ClipsEngineStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ClipsEngineStatus) => callback(status)
    ipcRenderer.on(IPC.CLIPS_ENGINE_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.CLIPS_ENGINE_STATUS, handler)
    }
  },
  clipsOnClipSaved: (callback: (data: { path?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { path?: string }) => callback(data)
    ipcRenderer.on(IPC.CLIPS_CLIP_SAVED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.CLIPS_CLIP_SAVED, handler)
    }
  },
}
