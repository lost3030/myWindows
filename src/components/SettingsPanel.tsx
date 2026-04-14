import { useState, useEffect, useRef } from 'react'
import type { AppConfig, StockInfo, StockSearchResult, ClockConfig } from '../types'

const MARKET_LABELS: Record<string, string> = {
  sh: 'A股 (沪)',
  sz: 'A股 (深)',
  bj: 'A股 (北)',
  hk: '港股',
  us: '美股',
  futures: '期货',
}

const POPULAR_STOCKS: StockInfo[] = [
  { code: '600519', market: 'sh', name: '贵州茅台' },
  { code: '000858', market: 'sz', name: '五粮液' },
  { code: '300750', market: 'sz', name: '宁德时代' },
  { code: '601318', market: 'sh', name: '中国平安' },
  { code: '920185', market: 'bj', name: '贝特瑞' },
  { code: 'B00Y', market: 'futures', name: '布伦特原油当月连续', secid: '112.B00Y' },
  { code: 'scm', market: 'futures', name: '原油主连', secid: '142.scm' },
  { code: '00700', market: 'hk', name: '腾讯控股' },
  { code: 'AAPL', market: 'us', name: 'Apple' },
  { code: 'NVDA', market: 'us', name: 'NVIDIA' },
  { code: 'TSLA', market: 'us', name: 'Tesla' },
]

const BACKGROUNDS = [
  { id: 'none', label: '无', desc: '默认玻璃效果' },
  { id: 'aurora', label: '极光', desc: '流动的北极光' },
  { id: 'sunset', label: '落日', desc: '温暖的夕阳色彩' },
  { id: 'ocean', label: '深海', desc: '深邃的海洋波光' },
  { id: 'forest', label: '幽林', desc: '静谧的森林之夜' },
  { id: 'cherry', label: '樱花', desc: '浪漫的樱花飘零' },
  { id: 'nebula', label: '星云', desc: '旋转的宇宙星尘' },
]

const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  showDate: true,
  showMilliseconds: true,
  showSeconds: true,
  format24h: true,
}

export default function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'widgets' | 'stocks' | 'theme'>('widgets')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    window.electronAPI.getAllConfig().then(setConfig)
    const off = window.electronAPI.onConfigUpdated((c: AppConfig) => setConfig(c))
    return () => off()
  }, [])

  useEffect(() => {
    const kw = searchKeyword.trim()
    if (!kw) {
      setSearchResults([])
      setShowDropdown(false)
      setSearching(false)
      return
    }
    setSearching(true)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchStock(kw)
        setSearchResults(results)
        setShowDropdown(results.length > 0)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchKeyword])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!config) {
    return (
      <div className="settings-panel">
        <div className="loading-screen"><div className="loading-spinner" /></div>
      </div>
    )
  }

  const stockWidget = config.widgets.find((w) => w.type === 'stock')
  const clockWidget = config.widgets.find((w) => w.type === 'clock')
  const stocks: StockInfo[] = (stockWidget?.config as { stocks?: StockInfo[] })?.stocks || []

  async function save(updated: AppConfig) {
    setSaving(true)
    setConfig(updated)
    await window.electronAPI.saveConfig(updated)
    setSaving(false)
  }

  function addFromSearch(result: StockSearchResult) {
    const stock: StockInfo = {
      code: result.code,
      market: result.market as StockInfo['market'],
      name: result.name,
      ...(result.secid ? { secid: result.secid } : {}),
    }
    if (stocks.some((s) => s.code === stock.code && s.market === stock.market)) return

    const updated = JSON.parse(JSON.stringify(config)) as AppConfig
    const sw = updated.widgets.find((w) => w.type === 'stock')
    if (sw) {
      ;(sw.config as { stocks: StockInfo[] }).stocks.push(stock)
    }
    save(updated)
    setSearchKeyword('')
    setSearchResults([])
    setShowDropdown(false)
  }

  function removeStock(idx: number) {
    const updated = JSON.parse(JSON.stringify(config)) as AppConfig
    const sw = updated.widgets.find((w) => w.type === 'stock')
    if (sw) {
      ;(sw.config as { stocks: StockInfo[] }).stocks.splice(idx, 1)
    }
    save(updated)
  }

  function quickAddStock(stock: StockInfo) {
    if (stocks.some((s) => s.code === stock.code && s.market === stock.market)) return
    const updated = JSON.parse(JSON.stringify(config)) as AppConfig
    const sw = updated.widgets.find((w) => w.type === 'stock')
    if (sw) {
      ;(sw.config as { stocks: StockInfo[] }).stocks.push({ ...stock })
    }
    save(updated)
  }

  async function addClockWidget() {
    await window.electronAPI.addWidget('clock', DEFAULT_CLOCK_CONFIG)
    const c = await window.electronAPI.getAllConfig()
    setConfig(c)
  }

  async function addStockWidget() {
    await window.electronAPI.addWidget('stock', { stocks: [], refreshInterval: 5000 })
    const c = await window.electronAPI.getAllConfig()
    setConfig(c)
  }

  async function removeWidget(id: string) {
    await window.electronAPI.removeWidget(id)
    const c = await window.electronAPI.getAllConfig()
    setConfig(c)
  }

  function updateClockConfig(key: keyof ClockConfig, value: boolean) {
    if (!clockWidget) return
    const updated = JSON.parse(JSON.stringify(config)) as AppConfig
    const cw = updated.widgets.find((w) => w.id === clockWidget.id)
    if (cw) {
      ;(cw.config as ClockConfig)[key] = value
    }
    save(updated)
  }

  function updateRefreshInterval(val: number) {
    if (!stockWidget) return
    const updated = JSON.parse(JSON.stringify(config)) as AppConfig
    const sw = updated.widgets.find((w) => w.id === stockWidget.id)
    if (sw) {
      ;(sw.config as { refreshInterval: number }).refreshInterval = val
    }
    save(updated)
  }

  return (
    <div className="settings-panel">
      <div className="settings-titlebar">
        <span className="settings-title">桌面组件设置</span>
        <div className="settings-titlebar-actions">
          <button
            className="titlebar-btn"
            type="button"
            onClick={() => void window.electronAPI.windowMinimize()}
          >
            ─
          </button>
          <button
            className="titlebar-btn titlebar-close"
            type="button"
            onClick={() => void window.electronAPI.windowClose()}
          >
            ×
          </button>
        </div>
      </div>

      <div className="settings-body">
        <div className="settings-tabs">
          <button className={`tab-btn ${tab === 'widgets' ? 'active' : ''}`} onClick={() => setTab('widgets')}>
            组件管理
          </button>
          <button className={`tab-btn ${tab === 'stocks' ? 'active' : ''}`} onClick={() => setTab('stocks')}>
            自选股
          </button>
          <button className={`tab-btn ${tab === 'theme' ? 'active' : ''}`} onClick={() => setTab('theme')}>
            外观
          </button>
          {saving && <span className="save-indicator">保存中...</span>}
        </div>

        {tab === 'widgets' && (
          <div className="settings-content">
            <div className="section">
              <h3 className="section-title">添加组件</h3>
              <div className="widget-gallery">
                <button className="gallery-card" onClick={addClockWidget}>
                  <div className="gallery-icon">🕐</div>
                  <div className="gallery-label">时钟组件</div>
                  <div className="gallery-desc">精确到毫秒的时间显示</div>
                </button>
                <button className="gallery-card" onClick={addStockWidget}>
                  <div className="gallery-icon">📈</div>
                  <div className="gallery-label">股票组件</div>
                  <div className="gallery-desc">实时行情 A股/港股/美股</div>
                </button>
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">已激活组件</h3>
              {config.widgets.length === 0 && (
                <div className="empty-hint">暂无组件，点击上方卡片添加</div>
              )}
              {config.widgets.map((w) => (
                <div key={w.id} className="active-widget-row">
                  <span className="active-widget-icon">{w.type === 'clock' ? '🕐' : '📈'}</span>
                  <span className="active-widget-name">
                    {w.type === 'clock' ? '时钟组件' : '股票组件'}
                  </span>
                  <span className="active-widget-id">{w.id}</span>
                  <button className="remove-btn" onClick={() => removeWidget(w.id)}>移除</button>
                </div>
              ))}
            </div>

            {clockWidget && (
              <div className="section">
                <h3 className="section-title">时钟设置</h3>
                <label className="toggle-row">
                  <span>显示日期</span>
                  <input
                    type="checkbox"
                    checked={(clockWidget.config as ClockConfig).showDate}
                    onChange={(e) => updateClockConfig('showDate', e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <span>显示秒</span>
                  <input
                    type="checkbox"
                    checked={(clockWidget.config as ClockConfig).showSeconds}
                    onChange={(e) => updateClockConfig('showSeconds', e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <span>显示毫秒</span>
                  <input
                    type="checkbox"
                    checked={(clockWidget.config as ClockConfig).showMilliseconds}
                    onChange={(e) => updateClockConfig('showMilliseconds', e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <span>24小时制</span>
                  <input
                    type="checkbox"
                    checked={(clockWidget.config as ClockConfig).format24h}
                    onChange={(e) => updateClockConfig('format24h', e.target.checked)}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {tab === 'stocks' && (
          <div className="settings-content">
            <div className="section">
              <h3 className="section-title">当前自选 ({stocks.length})</h3>
              {stocks.length === 0 && <div className="empty-hint">暂无自选股</div>}
              {stocks.map((s, idx) => (
                <div key={`${s.market}-${s.code}`} className="stock-row">
                  <span className="stock-row-market">{MARKET_LABELS[s.market]}</span>
                  <span className="stock-row-name">{s.name}</span>
                  <span className="stock-row-code">{s.code}</span>
                  <button className="remove-btn" onClick={() => removeStock(idx)}>移除</button>
                </div>
              ))}
            </div>

            <div className="section">
              <h3 className="section-title">搜索添加</h3>
              <div className="stock-search-wrapper" ref={searchRef}>
                <div className="search-input-row">
                  <input
                    className="form-input search-input"
                    placeholder="搜索代码或名称，如 512050、茅台、布伦特"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchResults.length > 0) {
                        const first = searchResults.find(
                          (r) => !stocks.some((s) => s.code === r.code && s.market === r.market),
                        )
                        if (first) addFromSearch(first)
                      }
                    }}
                  />
                  {searching && <div className="search-spinner" />}
                </div>
                {showDropdown && searchResults.length > 0 && (
                  <div className="search-dropdown">
                    {searchResults.map((result) => {
                      const exists = stocks.some(
                        (s) => s.code === result.code && s.market === result.market,
                      )
                      return (
                        <button
                          key={`${result.market}-${result.code}`}
                          className={`search-result-item ${exists ? 'exists' : ''}`}
                          onClick={() => !exists && addFromSearch(result)}
                          disabled={exists}
                        >
                          <span className="search-result-market">
                            {MARKET_LABELS[result.market] || result.market}
                          </span>
                          <span className="search-result-code">{result.code}</span>
                          <span className="search-result-name">{result.name}</span>
                          {result.type && (
                            <span className="search-result-type">{result.type}</span>
                          )}
                          {exists && <span className="search-result-added">✓ 已添加</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">热门股票快速添加</h3>
              <div className="popular-stocks">
                {POPULAR_STOCKS.map((s) => {
                  const exists = stocks.some((x) => x.code === s.code && x.market === s.market)
                  return (
                    <button
                      key={`${s.market}-${s.code}`}
                      className={`popular-chip ${exists ? 'added' : ''}`}
                      onClick={() => !exists && quickAddStock(s)}
                      disabled={exists}
                    >
                      <span className="chip-market">{MARKET_LABELS[s.market]}</span>
                      <span className="chip-name">{s.name}</span>
                      {exists && <span className="chip-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {stockWidget && (
              <div className="section">
                <h3 className="section-title">刷新间隔</h3>
                <div className="slider-row">
                  <input
                    type="range"
                    min="2000"
                    max="60000"
                    step="1000"
                    value={(stockWidget.config as { refreshInterval: number }).refreshInterval}
                    onChange={(e) => updateRefreshInterval(Number(e.target.value))}
                    className="form-slider"
                  />
                  <span className="slider-value">
                    {((stockWidget.config as { refreshInterval: number }).refreshInterval / 1000).toFixed(0)}s
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'theme' && (
          <div className="settings-content">
            <div className="section">
              <h3 className="section-title">透明度</h3>
              <div className="slider-row">
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.05"
                  value={config.theme.opacity}
                  onChange={(e) => {
                    const updated = { ...config, theme: { ...config.theme, opacity: Number(e.target.value) } }
                    save(updated)
                  }}
                  className="form-slider"
                />
                <span className="slider-value">{Math.round(config.theme.opacity * 100)}%</span>
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">主题色</h3>
              <div className="color-options">
                {['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6'].map(
                  (color) => (
                    <button
                      key={color}
                      className={`color-swatch ${config.theme.accentColor === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => {
                        const updated = { ...config, theme: { ...config.theme, accentColor: color } }
                        save(updated)
                      }}
                    />
                  ),
                )}
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">动态背景</h3>
              <div className="bg-grid">
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg.id}
                    className={`bg-card ${(config.theme.background || 'none') === bg.id ? 'active' : ''}`}
                    onClick={() => {
                      const updated = { ...config, theme: { ...config.theme, background: bg.id } }
                      save(updated)
                    }}
                  >
                    <div className={`bg-preview bg-preview-${bg.id}`} />
                    <div className="bg-card-info">
                      <span className="bg-card-label">{bg.label}</span>
                      <span className="bg-card-desc">{bg.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">关于</h3>
              <div className="about-text">
                <p>Desktop Widgets v1.0.0</p>
                <p>精美桌面自定义悬浮组件</p>
                <p className="about-sub">支持 A股(沪/深/北) · 港股 · 美股 · 期货 实时行情</p>
                <p className="about-sub">毫秒级精度时钟显示</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
