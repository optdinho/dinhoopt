import { toast } from 'sonner'

export function toastGroup(title: string, items: string[], options?: { duration?: number }): void {
  if (items.length === 0) return
  if (items.length === 1) {
    toast.success(`${title}: ${items[0]}`)
    return
  }
  toast.success(title, {
    description:
      items.length <= 5 ? items.join('\n') : `${items.slice(0, 4).join('\n')}\n... and ${items.length - 4} more`,
    duration: options?.duration ?? 5000,
  })
}
