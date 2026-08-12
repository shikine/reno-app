import { useMemo, useState } from 'react'
import { WINDOWS, WINDOW_PLACES, type WindowSpec } from '../data/windows'
import './WindowsTab.css'

export default function WindowsTab() {
  const [place, setPlace] = useState<string>('すべて')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return WINDOWS.filter((w) => {
      if (place !== 'すべて' && w.place !== place) return false
      if (!kw) return true
      return [w.id, w.type, w.code, w.size, w.place, w.func, w.note]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(kw))
    })
  }, [place, q])

  return (
    <div className="win-tab">
      <div className="win-head">
        <h3>建具・窓 一覧<span className="win-sub">烏帽子家</span></h3>
        <input className="win-search" placeholder="🔍 記号・種類・呼称・場所で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="win-places no-print">
        {['すべて', ...WINDOW_PLACES].map((p) => (
          <button key={p} className={place === p ? 'on' : ''} onClick={() => setPlace(p)}>{p}</button>
        ))}
      </div>

      <div className="win-count">{list.length} 件</div>

      <div className="win-list">
        {list.map((w) => <WinCard key={w.id} w={w} />)}
        {list.length === 0 && <div className="win-empty">該当なし</div>}
      </div>

      <p className="win-note">※サイズは呼称からの目安です。正確な製作寸法は発注時にメーカーへご確認ください。</p>
    </div>
  )
}

function WinCard({ w }: { w: WindowSpec }) {
  const specs = [w.func, w.glass, w.screen].filter(Boolean)
  return (
    <div className="win-card">
      <div className="win-card-top">
        <span className="win-id">{w.id}</span>
        <span className="win-type">{w.type}</span>
      </div>
      <div className="win-size">{w.size}</div>
      <div className="win-meta">
        <span className="win-code">呼称 {w.code}</span>
        {specs.length > 0 && <span className="win-specs">{specs.join(' ・ ')}</span>}
      </div>
      <div className="win-foot">
        <span className="win-place">📍 {w.place}</span>
        {w.note && <span className="win-badge">{w.note}</span>}
      </div>
    </div>
  )
}
