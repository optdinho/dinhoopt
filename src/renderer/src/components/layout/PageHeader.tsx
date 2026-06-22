import { cn } from '@/lib/utils'
import { memo } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

const PageHeader = memo(function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-5 flex items-end justify-between', className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm animate-fade-in" style={{ color: 'var(--text-muted)' }}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2.5">{action}</div>}
    </div>
  )
})

export { PageHeader }
