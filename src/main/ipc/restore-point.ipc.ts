import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import {
  createRestorePoint,
  deleteRestorePoint,
  enableSystemProtection,
  listRestorePoints,
  restoreToPoint,
} from '../services/restore-point'

export function registerRestorePointIpc(): void {
  getLogger().info('restore-point-ipc', 'Registrando handlers IPC de ponto de restauração')

  ipcMain.handle(
    IPC.RESTORE_POINT_CREATE,
    async (_event, description: string): Promise<{ success: boolean; error?: string; sequenceNumber?: number }> => {
      const desc = typeof description !== 'string' ? '' : description
      const sanitized = (desc || 'Ponto de restauração DiNho Optimizer')
        .replace(/[^\w\s.\-(),À-ÿœŒæÆ]/g, '')
        .slice(0, 200)

      getLogger().info('restore-point-ipc', `IPC: criar ponto de restauração "${sanitized}"`)
      const result = await createRestorePoint(sanitized)
      if (result.success) {
        getLogger().success('restore-point-ipc', `Ponto de restauração criado (seq: ${result.sequenceNumber})`)
      } else {
        getLogger().error('restore-point-ipc', `Falha ao criar ponto: ${result.error}`)
      }
      return result
    },
  )

  ipcMain.handle(IPC.RESTORE_POINT_ENABLE_PROTECTION, async (): Promise<{ success: boolean; error?: string }> => {
    getLogger().info('restore-point-ipc', 'IPC: ativar Proteção do Sistema')
    const result = await enableSystemProtection()
    if (result.success) {
      getLogger().success('restore-point-ipc', 'Proteção do Sistema ativada')
    } else {
      getLogger().error('restore-point-ipc', `Falha ao ativar proteção: ${result.error}`)
    }
    return result
  })

  ipcMain.handle(IPC.RESTORE_POINT_LIST, async (): Promise<{ success: boolean; points: unknown[]; error?: string }> => {
    getLogger().info('restore-point-ipc', 'IPC: listar pontos de restauração')
    const result = await listRestorePoints()
    if (result.success) {
      getLogger().info('restore-point-ipc', `${result.points.length} ponto(s) encontrado(s)`)
    } else {
      getLogger().error('restore-point-ipc', `Falha ao listar: ${result.error}`)
    }
    return result
  })

  ipcMain.handle(
    IPC.RESTORE_POINT_DELETE,
    async (_event, sequenceNumber: number): Promise<{ success: boolean; error?: string }> => {
      if (typeof sequenceNumber !== 'number' || !Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
        getLogger().warning('restore-point-ipc', `IPC: número de sequência inválido: ${sequenceNumber}`)
        return { success: false, error: 'Número de sequência inválido.' }
      }

      getLogger().info('restore-point-ipc', `IPC: excluir ponto ${sequenceNumber}`)
      const result = await deleteRestorePoint(sequenceNumber)
      if (result.success) {
        getLogger().success('restore-point-ipc', `Ponto ${sequenceNumber} excluído`)
      } else {
        getLogger().error('restore-point-ipc', `Falha ao excluir ponto ${sequenceNumber}: ${result.error}`)
      }
      return result
    },
  )

  ipcMain.handle(
    IPC.RESTORE_POINT_RESTORE,
    async (_event, sequenceNumber: number): Promise<{ success: boolean; error?: string }> => {
      if (typeof sequenceNumber !== 'number' || !Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
        getLogger().warning(
          'restore-point-ipc',
          `IPC: número de sequência inválido para restauração: ${sequenceNumber}`,
        )
        return { success: false, error: 'Número de sequência inválido.' }
      }

      getLogger().info('restore-point-ipc', `IPC: restaurar para o ponto ${sequenceNumber}`)
      const result = await restoreToPoint(sequenceNumber)
      if (result.success) {
        getLogger().success('restore-point-ipc', `Restauração para o ponto ${sequenceNumber} iniciada`)
      } else {
        getLogger().error('restore-point-ipc', `Falha ao restaurar para o ponto ${sequenceNumber}: ${result.error}`)
      }
      return result
    },
  )

  getLogger().success('restore-point-ipc', 'Handlers IPC de ponto de restauração registrados')
}
