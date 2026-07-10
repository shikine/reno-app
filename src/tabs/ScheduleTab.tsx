import { useRef, type PointerEvent as RPE } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import { pickScope } from '../db/estimateRepo'
import { addTask, createTasksFromMajors, deleteTask, updateTask } from '../db/taskRepo'
import { subtreeSum, yen } from '../estimate/estimateTotals'
import { computeOverall, isDelayed, localToday } from '../schedule/progress'
import { TextField } from '../ui/fields'
import { PhotoStrip } from '../ui/PhotoStrip'
import type { Task } from '../types/model'

const DAY = 24 * 60 * 60 * 1000

interface DragState {
  taskId: string
  mode: 'move' | 'resize'
  startX: number
  pxPerDay: number
  s: number
  e: number
  last: number
}

export default function ScheduleTab() {
  const tasks = (useLiveQuery(
    () => db.tasks.where('projectId').equals(PROJECT_ID).toArray(), [],
  ) ?? []).sort((a, b) => a.sortNo - b.sortNo)

  // 工種＝金額スコープ（契約＋凍結済み追加変更 / 契約前は編集中見積）の大項目
  const items = useLiveQuery(async () => {
    const ests = await db.estimates.toArray()
    const scopeIds = new Set(pickScope(ests).map((e) => e.id))
    const all = await db.estimateItems.toArray()
    return all.filter((i) => scopeIds.has(i.estimateId))
  }, []) ?? []

  const majors = items.filter((i) => i.type === 'major').sort((a, b) => a.sortNo - b.sortNo)
  const overall = computeOverall(tasks, items)
  const today = localToday()

  // ---- 簡易ガントの日付レンジ ----
  const dated = tasks.filter((t) => t.plannedStart && t.plannedEnd && t.plannedStart <= t.plannedEnd)
  const times = dated.flatMap((t) => [Date.parse(t.plannedStart!), Date.parse(t.plannedEnd!)])
  const todayT = Date.parse(today)
  let min = times.length ? Math.min(...times, todayT) : todayT
  let max = times.length ? Math.max(...times, todayT) : todayT + 30 * DAY
  min -= 2 * DAY
  max += 2 * DAY
  const span = Math.max(max - min, DAY)
  const pos = (t: number) => ((t - min) / span) * 100
  const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10)
  const shortDate = (t: number) => isoOf(t).slice(5).replace('-', '/')

  // 週目盛り（月曜ごと）
  const weekMarks: { t: number; label: string }[] = []
  {
    const dow = new Date(min).getUTCDay()
    const first = min + (((8 - dow) % 7) * DAY)
    for (let t = first; t <= max; t += 7 * DAY) weekMarks.push({ t, label: shortDate(t) })
  }

  // ガントバーのドラッグ（本体=移動 / 右端16px=終了日の伸縮）
  const drag = useRef<DragState | null>(null)
  const onBarDown = (ev: RPE<HTMLDivElement>, t: Task) => {
    if (!t.plannedStart || !t.plannedEnd) return
    const bar = ev.currentTarget
    const track = bar.parentElement as HTMLElement
    const w = track.getBoundingClientRect().width
    const resize = ev.clientX > bar.getBoundingClientRect().right - 16
    bar.setPointerCapture(ev.pointerId)
    drag.current = {
      taskId: t.id, mode: resize ? 'resize' : 'move',
      startX: ev.clientX, pxPerDay: w / (span / DAY),
      s: Date.parse(t.plannedStart), e: Date.parse(t.plannedEnd), last: 0,
    }
  }
  const onBarMove = (ev: RPE<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const delta = Math.round((ev.clientX - d.startX) / d.pxPerDay)
    if (delta === d.last) return
    d.last = delta
    if (d.mode === 'move') {
      updateTask(d.taskId, { plannedStart: isoOf(d.s + delta * DAY), plannedEnd: isoOf(d.e + delta * DAY) })
    } else {
      updateTask(d.taskId, { plannedEnd: isoOf(Math.max(d.s, d.e + delta * DAY)) })
    }
  }
  const onBarUp = () => { drag.current = null }

  const budgetOf = (majorId?: string) =>
    majorId ? subtreeSum(items, majorId) : undefined

  return (
    <div className="sched">
      <div className="sched-toolbar">
        <div className="overall">
          <span className="lbl">全体進捗</span>
          <div className="obar"><div className="ofill" style={{ width: `${overall.percent}%` }} /></div>
          <b>{overall.percent.toFixed(0)}%</b>
          <span className="ocount">完了 {overall.done}/{overall.total}</span>
          {overall.delayed > 0 && <span className="late-badge">遅延 {overall.delayed}件</span>}
        </div>
        <div className="sched-actions">
          <button onClick={() => createTasksFromMajors(majors.map((m) => ({ id: m.id, name: m.name })))}
            disabled={majors.length === 0} title="見積の大項目からタスクを一括生成">
            ⚡ 工種から一括作成
          </button>
          <button className="primary" onClick={() => addTask('新しいタスク')}>＋ タスク</button>
        </div>
      </div>

      {dated.length > 0 && (
        <div className="gantt">
          <div className="g-scale">
            <div className="g-scale-in">
              {weekMarks.map((m) => (
                <span key={m.t} style={{ left: `${pos(m.t)}%` }}>{m.label}</span>
              ))}
            </div>
          </div>
          <div className="g-rows">
            <div className="g-overlay">
              {weekMarks.map((m) => (
                <div className="g-week" key={m.t} style={{ left: `${pos(m.t)}%` }} />
              ))}
              <div className="g-today" style={{ left: `${pos(todayT)}%` }} title={`今日 ${today}`} />
            </div>
            {dated.map((t) => {
              const s = Date.parse(t.plannedStart!)
              const e = Date.parse(t.plannedEnd!) + DAY // 終了日を含める
              const late = isDelayed(t, today)
              return (
                <div className="g-row" key={t.id}>
                  <span className="g-name">{t.name}</span>
                  <div className="g-track">
                    <div className={`g-bar ${t.status === 'done' ? 'done' : late ? 'late' : ''}`}
                      style={{ left: `${pos(s)}%`, width: `${Math.max(pos(e) - pos(s), 1)}%` }}
                      onPointerDown={(ev) => onBarDown(ev, t)}
                      onPointerMove={onBarMove}
                      onPointerUp={onBarUp}
                      onPointerCancel={onBarUp}
                      title={`${t.name} ${t.plannedStart}〜${t.plannedEnd}（ドラッグ=移動 / 右端=伸縮）`}>
                      <div className="g-fill" style={{ width: `${t.percent}%` }} />
                      <span className="g-handle" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="muted small g-legend">バー＝ドラッグで日程移動、右端をつまむと工期伸縮。濃い部分＝進捗%。赤＝遅延。オレンジ縦線＝今日、細線＝週(月曜)。</p>
        </div>
      )}

      <div className="task-list">
        {tasks.length === 0 && (
          <p className="muted empty">「⚡ 工種から一括作成」（見積の大項目→タスク）または「＋ タスク」で追加してください。</p>
        )}
        {tasks.map((t) => {
          const late = isDelayed(t, today)
          const budget = budgetOf(t.linkedMajorId)
          const dep = t.dependsOnTaskId ? tasks.find((x) => x.id === t.dependsOnTaskId) : undefined
          const depConflict = !!(dep?.plannedEnd && t.plannedStart && t.plannedStart < dep.plannedEnd)
          return (
            <div className={`task-card ${late ? 'late' : ''} ${t.status === 'done' ? 'done' : ''}`} key={t.id}>
              <div className="t-row1">
                <TextField className="t-name" value={t.name}
                  onCommit={(v) => updateTask(t.id, { name: v })} />
                <select value={t.linkedMajorId ?? ''}
                  onChange={(e) => updateTask(t.id, { linkedMajorId: e.target.value || undefined })}>
                  <option value="">工種と未紐づけ</option>
                  {majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <TextField className="t-vendor" placeholder="職人/業者" value={t.vendorName ?? ''}
                  onCommit={(v) => updateTask(t.id, { vendorName: v })} />
                <input type="date" value={t.plannedStart ?? ''}
                  onChange={(e) => updateTask(t.id, { plannedStart: e.target.value || undefined })} />
                <span className="arrow">→</span>
                <input type="date" value={t.plannedEnd ?? ''}
                  onChange={(e) => updateTask(t.id, { plannedEnd: e.target.value || undefined })} />
                {late && <span className="late-badge">遅延</span>}
                <button className="del" onClick={() => deleteTask(t.id)} aria-label="削除">🗑</button>
              </div>
              <div className="t-row2">
                <input type="range" min={0} max={100} step={5} value={t.percent}
                  onChange={(e) => updateTask(t.id, { percent: Number(e.target.value) })} />
                <b className="pct">{t.percent}%</b>
                {t.status === 'done'
                  ? <span className="done-badge">✔ 完了</span>
                  : <button className="doneBtn" onClick={() => updateTask(t.id, { percent: 100 })}>✔ 完了に</button>}
                {budget && budget.cost > 0 && (
                  <span className="budget" title="紐づく工種の予定原価 × 進捗%">
                    予算 {yen(budget.cost)}・消化 {yen(budget.cost * t.percent / 100)}
                  </span>
                )}
                <select className="dep" value={t.dependsOnTaskId ?? ''}
                  title="前工程（この工程より前に終わるべきタスク）"
                  onChange={(e) => updateTask(t.id, { dependsOnTaskId: e.target.value || undefined })}>
                  <option value="">前工程なし</option>
                  {tasks.filter((x) => x.id !== t.id).map((x) => (
                    <option key={x.id} value={x.id}>← {x.name}</option>
                  ))}
                </select>
                {depConflict && (
                  <span className="late-badge"
                    title={`前工程「${dep!.name}」の終了予定(${dep!.plannedEnd})より前に開始予定になっています`}>
                    ⚠順序
                  </span>
                )}
                <TextField className="t-note" placeholder="メモ（現場の状況など）" value={t.note ?? ''}
                  onCommit={(v) => updateTask(t.id, { note: v })} />
              </div>
              <div className="t-row3">
                <PhotoStrip targetType="task" targetId={t.id} compact />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
