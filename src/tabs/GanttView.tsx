import { useEffect, useMemo, useState } from 'react'
import { listSurveys, type SurveyRecord } from '../cloud/api'
import { overallProgress } from '../survey/questions'
import { photoThumb, photoOpen } from '../cloud/image'
import './GanttView.css'

const DAY = 86400000

function dateOf(r: SurveyRecord): number | null {
  const wd = r.answers?.workDate
  const s = typeof wd === 'string' && wd ? wd : r.createdAt
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

interface Bar { name: string; startIdx: number; endIdx: number; pct: number }

function buildGantt(records: SurveyRecord[]) {
  const withDate = records
    .map((r) => ({ r, d: dateOf(r) }))
    .filter((x): x is { r: SurveyRecord; d: number } => x.d !== null)
    .sort((a, b) => a.d - b.d)
  if (!withDate.length) return null

  const minD = withDate[0].d
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const maxD = Math.max(withDate[withDate.length - 1].d, today)
  const days = Math.max(1, Math.round((maxD - minD) / DAY) + 1)

  const map = new Map<string, { start?: number; done?: number; pct: number }>()
  for (const { r, d } of withDate) {
    const sp = r.answers?.stageProgress
    if (!sp || typeof sp !== 'object') continue
    for (const [name, val] of Object.entries(sp as Record<string, unknown>)) {
      const pct = Math.max(0, Math.min(100, Number(val) || 0))
      let s = map.get(name)
      if (!s) { s = { pct: 0 }; map.set(name, s) }
      if (pct > 0 && s.start === undefined) s.start = d
      if (pct >= 100 && s.done === undefined) s.done = d
      s.pct = pct
    }
  }
  const idx = (d: number) => Math.round((d - minD) / DAY)
  const bars: Bar[] = [...map.entries()]
    .filter(([, s]) => s.start !== undefined)
    .map(([name, s]) => ({
      name,
      startIdx: idx(s.start as number),
      endIdx: s.done !== undefined ? idx(s.done) : idx(maxD),
      pct: s.pct,
    }))
    .sort((a, b) => a.startIdx - b.startIdx || a.name.localeCompare(b.name))

  return { bars, days, minD, todayIdx: idx(today), overall: overallProgress(latestStageMap(withDate)) }
}

function latestStageMap(withDate: { r: SurveyRecord; d: number }[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const { r } of withDate) {
    const sp = r.answers?.stageProgress
    if (sp && typeof sp === 'object') for (const [k, v] of Object.entries(sp as Record<string, unknown>)) acc[k] = Number(v) || 0
  }
  return acc
}

const DAY_W = 46
const LABEL_W = 96

export default function GanttView({ projectName }: { projectName?: string }) {
  const [rows, setRows] = useState<SurveyRecord[] | null>(null)
  const [err, setErr] = useState('')

  const load = () => {
    setErr(''); setRows(null)
    listSurveys(projectName).then(setRows).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => { load() }, [projectName]) // eslint-disable-line react-hooks/exhaustive-deps

  const g = useMemo(() => (rows ? buildGantt(rows) : null), [rows])
  const [selected, setSelected] = useState<SurveyRecord | null>(null)

  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}` }

  // 各記録を日付ポイントとして配置（同日は横に振り分け）
  const points = useMemo(() => {
    if (!rows || !g) return []
    const wd = rows.map((r) => ({ r, d: dateOf(r) })).filter((x): x is { r: SurveyRecord; d: number } => x.d !== null)
    const pts = wd.map((x) => ({ r: x.r, idx: Math.round((x.d - g.minD) / DAY) }))
    const counts = new Map<number, number>()
    pts.forEach((p) => counts.set(p.idx, (counts.get(p.idx) || 0) + 1))
    const seen = new Map<number, number>()
    return pts.map((p) => {
      const n = counts.get(p.idx) || 1
      const k = seen.get(p.idx) || 0
      seen.set(p.idx, k + 1)
      return { r: p.r, idx: p.idx, n, k }
    })
  }, [rows, g])

  return (
    <div className="gantt">
      <div className="gantt-head">
        <span className="gantt-title">工程ガント</span>
        <button onClick={load}>↻ 更新</button>
      </div>
      {err && <div className="survey-msg err">{err}</div>}
      {!rows && !err && <div className="survey-msg">読み込み中…</div>}
      {g && (
        <div className="gantt-overall">全体進捗（工程平均） <b>{g.overall}%</b>{g.overall >= 100 && <span className="gantt-clear"> ✅ 完了</span>}</div>
      )}
      {rows && !g && <div className="survey-msg">工程進捗の記録がまだありません。日報で工程%を入力すると、ここにガントが出ます。</div>}
      {g && (
        <div className="gantt-scroll">
          <div className="gantt-grid" style={{ width: LABEL_W + g.days * DAY_W }}>
            {/* 日付ヘッダ */}
            <div className="gantt-row gantt-axis">
              <div className="gantt-label" style={{ width: LABEL_W }}>工程</div>
              <div className="gantt-track" style={{ width: g.days * DAY_W }}>
                {Array.from({ length: g.days }).map((_, i) => (
                  <div key={i} className={`gantt-tick ${i === g.todayIdx ? 'today' : ''}`} style={{ left: i * DAY_W, width: DAY_W }}>
                    {(g.days <= 21 || i % 7 === 0) ? fmt(g.minD + i * DAY) : ''}
                  </div>
                ))}
              </div>
            </div>
            {/* 記録ポイント */}
            {points.length > 0 && (
              <div className="gantt-row gantt-marker-row">
                <div className="gantt-label" style={{ width: LABEL_W }}>記録</div>
                <div className="gantt-track" style={{ width: g.days * DAY_W }}>
                  {g.todayIdx >= 0 && g.todayIdx < g.days && <div className="gantt-todayline" style={{ left: g.todayIdx * DAY_W + DAY_W / 2 }} />}
                  {points.map((p, i) => {
                    const owner = p.r.answers?.category === '施主'
                    const left = p.idx * DAY_W + (DAY_W / (p.n + 1)) * (p.k + 1) - 10
                    return (
                      <button key={i} className={`gantt-dot ${owner ? 'owner' : 'worker'}`} style={{ left }}
                        title={p.r.summary} onClick={() => setSelected(p.r)}>{owner ? '施' : '工'}</button>
                    )
                  })}
                </div>
              </div>
            )}
            {/* 工程バー */}
            {g.bars.map((b) => {
              const left = b.startIdx * DAY_W
              const width = Math.max((b.endIdx - b.startIdx + 1) * DAY_W, DAY_W)
              return (
                <div key={b.name} className="gantt-row">
                  <div className="gantt-label" style={{ width: LABEL_W }} title={b.name}>{b.name}</div>
                  <div className="gantt-track" style={{ width: g.days * DAY_W }}>
                    {g.todayIdx >= 0 && g.todayIdx < g.days && <div className="gantt-todayline" style={{ left: g.todayIdx * DAY_W + DAY_W / 2 }} />}
                    <div className={`gantt-bar ${b.pct >= 100 ? 'done' : ''}`} style={{ left, width }}>
                      <div className="gantt-fill" style={{ width: `${b.pct}%` }} />
                      <span className="gantt-pct">{b.pct}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="gantt-note">※ 工程バーは「最初に%が入った日→100%/現在」。下の「記録」の●をタップすると内容が見られます。</p>

      {selected && <RecordModal r={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function RecordModal({ r, onClose }: { r: SurveyRecord; onClose: () => void }) {
  const owner = r.answers?.category === '施主'
  const photos = Array.isArray(r.answers?.photos) ? (r.answers.photos as string[]) : []
  const d = dateOf(r)
  const dateStr = d ? new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) : ''
  return (
    <div className="rec-overlay" onClick={onClose}>
      <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rec-modal-head">
          <span className={`rec-cat ${owner ? 'owner' : 'worker'}`}>{owner ? '施主' : '大工'}</span>
          <b className="rec-who">{r.respondent || '記録'}</b>
          <button className="rec-close" onClick={onClose}>×</button>
        </div>
        <div className="rec-date">{dateStr}</div>
        <div className="rec-body">{r.summary || '（内容なし）'}</div>
        {photos.length > 0 && (
          <div className="rec-photos">
            {photos.map((p, i) => (
              <a key={i} href={photoOpen(p)} target="_blank" rel="noreferrer"><img src={photoThumb(p, 400)} alt="" /></a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
