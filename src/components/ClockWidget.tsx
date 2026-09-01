import { useState, useEffect, useRef } from 'react'
import type { ClockConfig } from '../types'

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0')
}

const DEFAULT_CFG: ClockConfig = {
  showDate: true,
  showMilliseconds: true,
  showSeconds: true,
  format24h: true,
}

export default function ClockWidget({ config }: { config: ClockConfig | null }) {
  const cfg = config ? { ...DEFAULT_CFG, ...config } : DEFAULT_CFG
  const [time, setTime] = useState(() => new Date())
  const spinnerRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef(0)
  const lastHmsRef = useRef({ h: -1, m: -1, s: -1 })

  useEffect(() => {
    if (cfg.showMilliseconds) {
      // 毫秒指针原本每一帧都写一次 CSS transform,而这是个透明置顶窗口,
      // 每写一次就要重新合成一次整窗,实测把 GPU 进程拉到 30% 单核。
      // 节流到 20fps:肉眼看仍然是连续转动,合成压力降一个量级。
      const MIN_FRAME_MS = 50
      let lastFrameTs = 0
      const loop = (ts: number) => {
        rafRef.current = requestAnimationFrame(loop)
        if (ts - lastFrameTs < MIN_FRAME_MS) return
        lastFrameTs = ts
        const now = new Date()
        const el = spinnerRef.current
        if (el) {
          el.style.transform = `rotate(${(now.getMilliseconds() / 1000) * 360}deg)`
        }
        const h = cfg.format24h ? now.getHours() : now.getHours() % 12 || 12
        const m = now.getMinutes()
        const s = now.getSeconds()
        const last = lastHmsRef.current
        if (h !== last.h || m !== last.m || s !== last.s) {
          lastHmsRef.current = { h, m, s }
          setTime(now)
        }
      }
      rafRef.current = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(rafRef.current)
    }

    setTime(new Date())

    if (cfg.showSeconds) {
      const id = window.setInterval(() => setTime(new Date()), 1000)
      return () => clearInterval(id)
    }

    let timeoutId = 0
    let intervalId = 0
    const alignMinute = () => {
      setTime(new Date())
      const now = new Date()
      const msToNext = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds())
      timeoutId = window.setTimeout(() => {
        setTime(new Date())
        intervalId = window.setInterval(() => setTime(new Date()), 60000)
      }, msToNext)
    }
    alignMinute()
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [cfg.showMilliseconds, cfg.showSeconds, cfg.format24h])

  const h = cfg.format24h ? time.getHours() : time.getHours() % 12 || 12
  const m = time.getMinutes()
  const s = time.getSeconds()
  const ampm = !cfg.format24h ? (time.getHours() >= 12 ? 'PM' : 'AM') : ''

  const dateStr = `${time.getFullYear()}年${time.getMonth() + 1}月${time.getDate()}日`
  const weekStr = `星期${WEEK_DAYS[time.getDay()]}`

  return (
    <div className="widget clock-widget" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="widget-header">
        <span className="widget-title">
          <span className="widget-dot" />
          时钟
        </span>
        <button
          className="widget-close"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          type="button"
          onClick={() => void window.electronAPI.closeWidget()}
        >
          ×
        </button>
      </div>

      <div className="clock-display">
        <div className="clock-time">
          <span className="clock-digits">{pad(h)}</span>
          <span className="clock-separator">:</span>
          <span className="clock-digits">{pad(m)}</span>
          {cfg.showSeconds && (
            <>
              <span className="clock-separator">:</span>
              <span className="clock-digits">{pad(s)}</span>
            </>
          )}
          {cfg.showMilliseconds && (
            <span className="clock-spinner-wrap">
              <span className="clock-spinner-track" />
              <span className="clock-spinner-tick" />
              <span ref={spinnerRef} className="clock-ms clock-ms-spinner" />
            </span>
          )}
          {ampm && <span className="clock-ampm">{ampm}</span>}
        </div>

        {cfg.showDate && (
          <div className="clock-date">
            <span className="clock-date-text">{dateStr}</span>
            <span className="clock-date-divider">·</span>
            <span className="clock-date-text">{weekStr}</span>
          </div>
        )}
      </div>
    </div>
  )
}
