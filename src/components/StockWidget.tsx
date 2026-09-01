import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { StockInfo, StockConfig, StockData, TrendPoint } from '../types'

const CURRENCY: Record<string, string> = {
  sh: '¥',
  sz: '¥',
  bj: '¥',
  hk: 'HK$',
  us: '$',
  futures: '',
}

const MARKET_SHORT: Record<string, string> = {
  sh: 'SH',
  sz: 'SZ',
  bj: 'BJ',
  hk: 'HK',
  us: 'US',
  futures: '期货',
}

function formatPrice(price: number | null | undefined, market: string): string {
  if (price == null || price === 0) return '--'
  const prefix = CURRENCY[market] ?? ''
  // 债券收益率、低价 ETF 这类小数值,两位小数会把基点级别的变动整个抹平
  // (30 年期收益率一整天都显示 5.32),所以按量级分档给小数位。
  const digits = Math.abs(price) < 10 ? 3 : 2
  return `${prefix}${price.toFixed(digits)}`
}

function formatChange(val: number | null | undefined): string {
  if (val == null) return '0.00%'
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`
}

function timeToMinutes(t: string): number {
  const m = t.match(/(\d{2}):(\d{2})/)
  if (!m) return 0
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

// 判断"这里是不是休市断点"的阈值必须跟着实际采样间隔走。分时序列被降采样后,
// 相邻两点可能相隔 6-9 分钟;如果还拿写死的 5 分钟当阈值,就会把每一个点都判成
// 独立线段,段间距吃光画布宽度,整条线直接消失(2026-08-20 布伦特原油实测)。
function detectSegments(times: string[]) {
  const segs: { start: number; end: number }[] = []
  if (times.length === 0) return segs

  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = timeToMinutes(times[i]) - timeToMinutes(times[i - 1])
    if (d > 0) gaps.push(d)
  }
  gaps.sort((a, b) => a - b)
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1
  const threshold = Math.max(5, median * 3)

  let start = 0
  for (let i = 1; i < times.length; i++) {
    const diff = timeToMinutes(times[i]) - timeToMinutes(times[i - 1])
    if (diff > threshold || diff < -threshold) {
      segs.push({ start, end: i - 1 })
      start = i
    }
  }
  segs.push({ start, end: times.length - 1 })
  return segs
}

function extractTimeLabel(times: string[]): string {
  if (!times || times.length < 2) return ''
  const first = times[0].match(/(\d{2}:\d{2})/)?.[1] || ''
  const last = times[times.length - 1].match(/(\d{2}:\d{2})/)?.[1] || ''
  return `${first} – ${last}`
}

interface SparklineProps {
  prices: number[]
  times: string[]
  preClose: number
  isUp: boolean
  isFlat: boolean
}

const Sparkline = memo(function Sparkline({ prices, times, preClose, isUp, isFlat }: SparklineProps) {
  if (!prices || prices.length < 3) return null

  const W = 86
  const H = 34
  const PAD = 1

  const segments = detectSegments(times)
  // 段间距总和封顶在画布宽度的 1/4,兜住"分段数意外爆炸"的情况——
  // 哪怕阈值再判错,折线也至少还有 3/4 的宽度可画,不会整条消失。
  const maxGapTotal = (W - PAD * 2) * 0.25
  const GAP = segments.length > 1 ? Math.min(3, maxGapTotal / (segments.length - 1)) : 0
  const gapTotal = GAP * Math.max(0, segments.length - 1)
  const usable = W - PAD * 2 - gapTotal
  const total = prices.length

  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const span = hi - lo || 1

  const coords: { x: number; y: number }[] = new Array(total)
  let xOff = PAD

  for (const seg of segments) {
    const len = seg.end - seg.start + 1
    const segW = (len / total) * usable
    for (let i = seg.start; i <= seg.end; i++) {
      const li = i - seg.start
      const x = xOff + (len > 1 ? (li / (len - 1)) * segW : segW / 2)
      const y = H - PAD - ((prices[i] - lo) / span) * (H - PAD * 2)
      coords[i] = { x, y }
    }
    xOff += segW + GAP
  }

  const color = isFlat ? 'var(--stock-flat)' : isUp ? 'var(--stock-up)' : 'var(--stock-down)'
  const fillC = isFlat
    ? 'rgba(148,163,184,0.06)'
    : isUp
      ? 'rgba(239,68,68,0.1)'
      : 'rgba(34,197,94,0.1)'

  const pt = (c: { x: number; y: number }) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`
  const els: React.ReactNode[] = []

  if (preClose >= lo && preClose <= hi) {
    const refY = H - PAD - ((preClose - lo) / span) * (H - PAD * 2)
    els.push(
      <line key="ref" x1={PAD} y1={refY.toFixed(1)} x2={W - PAD} y2={refY.toFixed(1)}
        stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />,
    )
  }

  for (let s = 0; s < segments.length; s++) {
    const { start, end } = segments[s]
    const sc = coords.slice(start, end + 1)
    const line = sc.map(pt).join(' ')
    const area = `${sc[0].x.toFixed(1)},${H} ${line} ${sc[sc.length - 1].x.toFixed(1)},${H}`
    els.push(
      <g key={`s${s}`}>
        <polygon points={area} fill={fillC} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </g>,
    )
  }

  const last = coords[coords.length - 1]
  els.push(<circle key="dot" cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="2.5" fill={color} />)

  return (
    <svg width={W} height={H} className="sparkline" viewBox={`0 0 ${W} ${H}`}>
      {els}
    </svg>
  )
})

// ─── Drag-to-reorder ─────────────────────────────────────────────────────────

interface DragState {
  idx: number
  startY: number
  currentY: number
}

export default function StockWidget({ config, id }: { config: StockConfig | null; id: string }) {
  const [stockData, setStockData] = useState<StockData[]>([])
  const [trendData, setTrendData] = useState<Record<string, TrendPoint>>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [localOrder, setLocalOrder] = useState<StockInfo[] | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const mountedRef = useRef(true)
  const lastTrendRef = useRef(0)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const stocks = localOrder ?? config?.stocks ?? []

  const fetchData = useCallback(async () => {
    if (!config?.stocks?.length) {
      setLoading(false)
      return
    }
    try {
      const data = await window.electronAPI.fetchStocks(config.stocks)
      if (!mountedRef.current) return
      if (data && data.length > 0) {
        setStockData(data)
        setLastUpdate(new Date())
        setError(false)
      }

      const now = Date.now()
      if (now - lastTrendRef.current > 60000) {
        lastTrendRef.current = now
        const trends = await window.electronAPI.fetchStockTrends(config.stocks)
        if (mountedRef.current && trends) {
          setTrendData(trends)
        }
      }
    } catch {
      if (mountedRef.current) setError(true)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [config])

  useEffect(() => {
    mountedRef.current = true
    lastTrendRef.current = 0
    fetchData()
    timerRef.current = setInterval(fetchData, config?.refreshInterval || 5000)
    return () => {
      mountedRef.current = false
      clearInterval(timerRef.current)
    }
  }, [fetchData, config?.refreshInterval])

  useEffect(() => {
    setLocalOrder(null)
  }, [config?.stocks])

  // 取数失败时组件根本不会重渲染,光靠 lastUpdate 发现不了"行情已经停住了",
  // 所以这里自己起一个 5 秒心跳来推进时间判断。
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const staleAfterMs = Math.max((config?.refreshInterval || 5000) * 3, 60000)
  const isStale = lastUpdate != null && now - lastUpdate.getTime() > staleAfterMs
  const sources = Array.from(new Set(stockData.map((d) => d.source).filter(Boolean)))
  const allSourcesDead = !loading && stocks.length > 0 && stockData.length === 0

  function getStockData(s: StockInfo): StockData | undefined {
    return stockData.find((d) => d.code === s.code && d.market === s.market)
  }

  function onDragStart(idx: number, clientY: number) {
    setDrag({ idx, startY: clientY, currentY: clientY })
  }

  function onDragMove(clientY: number) {
    if (!drag) return
    setDrag({ ...drag, currentY: clientY })

    const items = itemRefs.current
    if (!items.length) return
    const itemH = items[0]?.getBoundingClientRect().height || 60
    const delta = clientY - drag.startY
    const shift = Math.round(delta / itemH)

    if (shift !== 0) {
      const order = [...stocks]
      const from = drag.idx
      const to = Math.max(0, Math.min(order.length - 1, from + shift))
      if (from !== to) {
        const [moved] = order.splice(from, 1)
        order.splice(to, 0, moved)
        setLocalOrder(order)
        setDrag({ idx: to, startY: clientY, currentY: clientY })
      }
    }
  }

  function onDragEnd() {
    if (!drag || !localOrder) {
      setDrag(null)
      return
    }
    setDrag(null)
    window.electronAPI.getAllConfig().then((cfg) => {
      const sw = cfg.widgets.find((w) => w.type === 'stock')
      if (sw) {
        ;(sw.config as StockConfig).stocks = [...localOrder]
        window.electronAPI.saveConfig(cfg)
      }
    })
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => onDragMove(e.clientY)
    const onUp = () => onDragEnd()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  })

  return (
    <div className="widget stock-widget" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="widget-header">
        <span className="widget-title">
          <span className="widget-dot dot-stock" />
          自选股
        </span>
        <div className="widget-actions" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="widget-btn" type="button" onClick={() => void window.electronAPI.openSettings()} title="设置">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
          <button className="widget-close" type="button" onClick={() => void window.electronAPI.closeWidget()}>×</button>
        </div>
      </div>

      <div
        className={`stock-list${isStale ? ' is-stale' : ''}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {loading && (
          <div className="stock-skeleton-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="stock-skeleton" />
            ))}
          </div>
        )}

        {!loading && stocks.length === 0 && (
          <div className="stock-empty">
            <div className="stock-empty-icon">📊</div>
            <div className="stock-empty-text">
              {error ? '数据加载失败，稍后重试' : '暂无自选股'}
            </div>
            <button className="stock-empty-btn" type="button" onClick={() => void window.electronAPI.openSettings()}>
              前往设置
            </button>
          </div>
        )}

        {allSourcesDead && (
          <div className="stock-empty">
            <div className="stock-empty-icon">📡</div>
            <div className="stock-empty-text">所有数据源都取不到行情</div>
          </div>
        )}

        {stocks.map((s, idx) => {
          const stock = getStockData(s)
          if (!stock) return null
          const isUp = stock.changePercent > 0
          const isDown = stock.changePercent < 0
          const isFlat = !isUp && !isDown
          const cls = isUp ? 'up' : isDown ? 'down' : 'flat'
          const trend = trendData[`${stock.market}-${stock.code}`]
          const isDragging = drag?.idx === idx

          return (
            <div
              key={`${s.market}-${s.code}`}
              ref={(el) => { itemRefs.current[idx] = el }}
              className={`stock-item stock-${cls} ${isDragging ? 'dragging' : ''}`}
            >
              <div
                className="drag-handle"
                onPointerDown={(e) => {
                  e.preventDefault()
                  onDragStart(idx, e.clientY)
                }}
              >
                <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" opacity="0.3">
                  <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
                  <circle cx="3" cy="6" r="1.2" /><circle cx="7" cy="6" r="1.2" />
                  <circle cx="3" cy="10" r="1.2" /><circle cx="7" cy="10" r="1.2" />
                  <circle cx="3" cy="14" r="1.2" /><circle cx="7" cy="14" r="1.2" />
                </svg>
              </div>
              <div className="stock-info">
                <span className="stock-name">{stock.name}</span>
                <span className="stock-code">
                  {MARKET_SHORT[stock.market] || stock.market.toUpperCase()} : {stock.code}
                </span>
              </div>
              <div className="stock-chart-area">
                {trend && (
                  <>
                    <Sparkline
                      prices={trend.prices}
                      times={trend.times}
                      preClose={trend.preClose}
                      isUp={isUp}
                      isFlat={isFlat}
                    />
                    <span className="chart-time-range">{extractTimeLabel(trend.times)}</span>
                  </>
                )}
              </div>
              <div className="stock-price-area">
                <span className={`stock-change-pct stock-change-pct-${cls}`}>
                  {formatChange(stock.changePercent)}
                  <span className="stock-arrow">{isUp ? ' ▲' : isDown ? ' ▼' : ''}</span>
                </span>
                <span className="stock-price-secondary">{formatPrice(stock.price, stock.market)}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="stock-footer">
        {isStale && lastUpdate ? (
          <span className="stock-stale-warn">
            ⚠ 行情已停滞 · 最后更新 {lastUpdate.toLocaleTimeString('zh-CN')}
          </span>
        ) : lastUpdate ? (
          <span className="stock-update-time">
            更新于 {lastUpdate.toLocaleTimeString('zh-CN')}
            {sources.length > 0 && <span className="stock-source"> · {sources.join('/')}</span>}
          </span>
        ) : null}
      </div>
    </div>
  )
}
