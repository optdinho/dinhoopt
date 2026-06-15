import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation } from 'react-i18next'
import type { WithTranslation } from 'react-i18next'

interface ErrorBoundaryProps extends WithTranslation {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundaryInternal extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info)
  }

  handleReset = (): void => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      const { t } = this.props

      return (
        <div role="alert" className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold mb-2">{t('common:errorTitle')}</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            {this.state.error.message || t('common:errorTitle')}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('common:errorTryAgain')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInternal)
