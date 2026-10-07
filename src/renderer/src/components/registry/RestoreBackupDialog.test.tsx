// @vitest-environment jsdom

import type { RegistryBackupInfo } from '@shared/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RestoreBackupDialog } from './RestoreBackupDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  return {
    Archive: Icon,
    Clock: Icon,
    Database: Icon,
    FileWarning: Icon,
    FolderClock: Icon,
    History: Icon,
    Loader2: Icon,
    ShieldAlert: Icon,
  }
})

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/lib/utils', () => ({
  formatBytes: (bytes: number) => `${bytes} B`,
}))

const restoreList = vi.fn()
const restore = vi.fn()

function mockWindowDinho() {
  window.dinho = {
    registryRestoreList: restoreList,
    registryRestore: restore,
  } as never
}

const backups: RegistryBackupInfo[] = [
  {
    name: 'registry-backup-targeted-2026-10-06T10-00-00-000Z.reg',
    timestamp: '2026-10-06T10-00-00-000Z',
    kind: 'targeted',
    size: 1024,
  },
  {
    name: 'registry-backup-2026-10-06T09-00-00-000Z.reg',
    timestamp: '2026-10-06T09-00-00-000Z',
    kind: 'full',
    size: 2048,
  },
  {
    name: 'registry-backup-tasks-2026-10-06T08-00-00-000Z',
    timestamp: '2026-10-06T08-00-00-000Z',
    kind: 'tasks',
    size: 4096,
  },
]

describe('RestoreBackupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindowDinho()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<RestoreBackupDialog open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows an empty state when no backups are found', async () => {
    restoreList.mockResolvedValue([])
    render(<RestoreBackupDialog open onClose={() => {}} />)
    expect(await screen.findByText('restoreNoBackups')).toBeTruthy()
  })

  it('lists the backups classified by kind', async () => {
    restoreList.mockResolvedValue(backups)
    render(<RestoreBackupDialog open onClose={() => {}} />)
    expect(await screen.findByTestId('restore-entry-targeted')).toBeTruthy()
    expect(screen.getByTestId('restore-entry-full')).toBeTruthy()
    expect(screen.getByTestId('restore-entry-tasks')).toBeTruthy()
  })

  it('disables scheduled-task entries', async () => {
    restoreList.mockResolvedValue(backups)
    render(<RestoreBackupDialog open onClose={() => {}} />)
    const tasks = await screen.findByTestId('restore-entry-tasks')
    expect((tasks as HTMLButtonElement).disabled).toBe(true)
  })

  it('restores the selected backup and closes on success', async () => {
    restoreList.mockResolvedValue(backups)
    restore.mockResolvedValue({ ok: true })
    const onClose = vi.fn()
    render(<RestoreBackupDialog open onClose={onClose} />)
    fireEvent.click(await screen.findByTestId('restore-entry-targeted'))
    fireEvent.click(screen.getByText('restoreConfirmLabel'))
    await waitFor(() => expect(restore).toHaveBeenCalledWith(backups[0]!.name))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastMocks.success).toHaveBeenCalled()
  })

  it('shows an error toast when the restore fails', async () => {
    restoreList.mockResolvedValue(backups)
    restore.mockResolvedValue({ ok: false, message: 'Access is denied.' })
    const onClose = vi.fn()
    render(<RestoreBackupDialog open onClose={onClose} />)
    fireEvent.click(await screen.findByTestId('restore-entry-targeted'))
    fireEvent.click(screen.getByText('restoreConfirmLabel'))
    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('restoreFailedTitle', {
        description: 'Access is denied.',
        duration: 6000,
      }),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
