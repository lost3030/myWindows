import { useEffect, useState } from 'react'
import type { AppConfig, ClockConfig, StockConfig } from './types'
import ClockWidget from './components/ClockWidget'
import StockWidget from './components/StockWidget'
import SettingsPanel from './components/SettingsPanel'

type WidgetView =
  | { type: 'clock'; id: string; config: ClockConfig }
  | { type: 'stock'; id: string; config: StockConfig }
  | { type: 'settings' }
  | { type: 'loading' }

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function applyTheme(theme: AppConfig['theme']) {
  if (!theme) return
  const root = document.documentElement
  const c = theme.accentColor || '#6366f1'
  root.style.setProperty('--accent', c)
  root.style.setProperty('--accent-dim', hexToRgba(c, 0.15))
  root.style.setProperty('--accent-hover-border', hexToRgba(c, 0.2))
  root.style.setProperty('--accent-glow', hexToRgba(c, 0.06))
  root.style.setProperty('--accent-glow-strong', hexToRgba(c, 0.4))
  root.style.setProperty('--bg-widget', `rgba(12, 12, 28, ${theme.opacity ?? 0.88})`)
  root.dataset.bg = theme.background || 'none'
}

export default function App() {
  const [view, setView] = useState<WidgetView>({ type: 'loading' })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const widgetType = params.get('widget')
    const widgetId = params.get('id')

    window.electronAPI.getAllConfig().then((cfg) => {
      applyTheme(cfg.theme)
    })

    const offConfig = window.electronAPI.onConfigUpdated((cfg) => {
      applyTheme(cfg.theme)
    })

    const offWidget = window.electronAPI.onWidgetConfigUpdated((cfg) => {
      setView((prev) => {
        if (prev.type === 'clock') return { ...prev, config: cfg as ClockConfig }
        if (prev.type === 'stock') return { ...prev, config: cfg as StockConfig }
        return prev
      })
    })

    if (widgetType === 'settings') {
      setView({ type: 'settings' })
    } else if (widgetId) {
      window.electronAPI.getWidgetConfig(widgetId).then((cfg) => {
        if (widgetType === 'clock') {
          setView({ type: 'clock', id: widgetId, config: cfg as ClockConfig })
        } else if (widgetType === 'stock') {
          setView({ type: 'stock', id: widgetId, config: cfg as StockConfig })
        }
      })
    }

    return () => {
      offConfig()
      offWidget()
    }
  }, [])

  switch (view.type) {
    case 'clock':
      return <ClockWidget config={view.config} />
    case 'stock':
      return <StockWidget config={view.config} id={view.id} />
    case 'settings':
      return <SettingsPanel />
    default:
      return (
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      )
  }
}
