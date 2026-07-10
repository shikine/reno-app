import { useRef, useState, type DragEvent, type PointerEvent as RPE } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import { pickScope } from '../db/estimateRepo'
import { addTask, createTasksFromMajors, deleteTask, moveTask, updateTask } from '../db/taskRepo'
import { subtreeSum, yen } from '../estimate/estimateTotals'
import { computeOverall, isDelayed, localToday } from '../schedule/progress'
import { TextField } from '../ui/fields'
import { PhotoStrip } from '../ui/PhotoStrip'
import type { Task } from '../types/model'

const DAY = 24 * 60 * 60 * 1000
const MAX_DEPTH = 2 // 0=大工程, 1=中工程, 2=小工程
const DEPTH_LABEL = ['大', '中', '小']

interface DragState {
  taskId: string
  mode: 'move' | 'resize'
  startX: number
  pxPerDay: number
  s: number
  e: number
  last: number
}

interface Rollup {
  percent: number
  start?: string
  end?: string
  leaves: number
}

export default function ScheduleTab() {
  const tasks = useLiveQuery(
    () => db.tasks.where('projectId').equals(PROJECT_ID).toArray(), [],
  ) ?? []

  // 工種＝金額スコープ（契約＋凍結済み追加変更 / 契約前は編集中見積）の大項目
  const items = useLiveQuery(async () => {
    const ests = await db.estimates.toArray()
    const scopeIds = new Set(pickScope(ests).map((e) => e.id))
    const all = await db.estimateItems.toArray()
    return all.filter((i) => scopeIds.has(i.estimateId))
  }, []) ?? []

  const majors = items.filter((i) => i.type === 'major').sort((a, b) => a.sortNo - b.sortNo)
  const today = localToday()

  // ---- 階層ツリー ----
  const childrenOf = (id: string | undefined) =>
    tasks.filter((t) => (t.parentTaskId ?? undefined) === id).sort((a, b) => a.sortNo - b.sortNo)
  const hasChildren = (id: string) => tasks.some((t) => t.parentTaskId === id)

  const flat: { t: Task; depth: number }[] = []
  const walk = (parentId: string | undefined, depth: number) => {
    for (const t of childrenOf(parentId)) {
      flat.push({ t, depth })
      if (depth < MAX_DEPTH) walk(t.id, depth + 1)
    }
  }
  walk(undefined, 0)

  // 末端工程（進捗の実体）。全体進捗は末端のみで計算（二重計上防止）
  const leaves = tasks.filter((t) => !hasChildren(t.id))
  const overall = computeOverall(leaves, items)

  // 親工程の自動集計：日程=配下末端の最早開始〜最遅終了、進捗=末端の平均
  const leavesUnder = (id: string): Task[] => {
    const cs = childrenOf(id)
    if (cs.length === 0) {
      const self = tasks.find((x) => x.id === id)
      return self ? [self] : []
    }
    return cs.flatMap((c) => leavesUnder(c.id))
  }
  const rollupOf = (t: Task): Rollup | null => {
    if (!hasChildren(t.id)) return null
    const ls = leavesUnder(t.id)
    const starts = ls.map((x) => x.plannedStart).filter(Boolean).sort() as string[]
    const ends = ls.map((x) => x.plannedEnd).filter(Boolean).sort() as string[]
    return {
      percent: ls.length ? ls.reduce((s, x) => s + x.percent, 0) / ls.length : 0,
      start: starts[0],
      end: ends[ends.length - 1],
      leaves: ls.length,
    }
  }

  // ---- ガントの折りたたみ（既定: 大工程のみ。▸で展開） ----
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const parentIds = tasks.filter((t) => hasChildren(t.id)).map((t) => t.id)
  const expandAll = () => setExpanded(new Set(parentIds))
  const collapseAll = () => setExpanded(new Set())

  const gVisible: { t: Task; depth: number }[] = []
  const gwalk = (parentId: string | undefined, depth: number) => {
    for (const t of childrenOf(parentId)) {
      gVisible.push({ t, depth })
      if (depth < MAX_DEPTH && hasChildren(t.id) && expanded.has(t.id)) gwalk(t.id, depth + 1)
    }
  }
  gwalk(undefined, 0)

  // ---- ガントの日付レンジ ----
  interface GRow { t: Task; depth: number; s: number; e: number; percent: number; parent: boolean; late: boolean }
  const gRows: GRow[] = []
  for (const { t, depth } of gVisible) {
    const ru = rollupOf(t)
    const start = ru ? ru.start : t.plannedStart
    const end = ru ? ru.end : t.plannedEnd
    if (!start || !end || start > end) continue
    const percent = ru ? ru.percent : t.percent
    const late = ru
      ? (!!ru.end && ru.end < today && percent < 100)
      : isDelayed(t, today)
    gRows.push({ t, depth, s: Date.parse(start), e: Date.parse(end), percent, parent: !!ru, late })
  }
  const todayT = Date.parse(today)
  const times = gRows.flatMap((r) => [r.s, r.e])
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

  // ---- ガントバーのドラッグ（末端のみ。本体=移動 / 右端16px=伸縮） ----
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

  // ---- 並べ替え（⠿ハンドルをドラッグ。同じ親の中で上下） ----
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [overTask, setOverTask] = useState<{ id: string; after: boolean } | null>(null)

  const onCardDragOver = (ev: DragEvent<HTMLDivElement>, t: Task) => {
    if (!dragTaskId || dragTaskId === t.id) return
    const dragT = tasks.find((x) => x.id === dragTaskId)
    if (!dragT || (dragT.parentTaskId ?? null) !== (t.parentTaskId ?? null)) return
    ev.preventDefault()
    const rect = ev.currentTarget.getBoundingClientRect()
    setOverTask({ id: t.id, after: ev.clientY > rect.top + rect.height / 2 })
  }
  const onCardDrop = async (ev: DragEvent<HTMLDivElement>, t: Task) => {
    ev.preventDefault()
    if (dragTaskId && overTask && overTask.id === t.id) {
      await moveTask(dragTaskId, t.id, overTask.after)
    }
    setDragTaskId(null)
    setOverTask(null)
  }

  const budgetOf = (majorId?: string) => (majorId ? subtreeSum(items, majorId) : undefined)

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
          <button className="primary" onClick={() => addTask('新しい工程')}>＋ 大工程</button>
        </div>
      </div>

      {gRows.length > 0 && (
        <div className="gantt">
          {parentIds.length > 0 && (
            <div className="g-tools">
              <button onClick={expandAll}>▾ すべて展開</button>
              <button onClick={collapseAll}>▸ すべて畳む</button>
            </div>
          )}
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
            {gRows.map((r) => (
              <div className="g-row" key={r.t.id}>
                <span className={`g-name ${r.parent ? 'g-parent-name' : ''}`}
                  style={{ paddingLeft: r.depth * 14 }}>
                  {r.parent ? (
                    <button className="g-caret"
                      title={expanded.has(r.t.id) ? '配下を折りたたむ' : '配下を展開'}
                      onClick={() => toggleExpand(r.t.id)}>
                      {expanded.has(r.t.id) ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="g-caret-sp" />
                  )}
                  {r.t.name}
                </span>
                <div className="g-track">
                  {r.parent ? (
                    <div className={`g-bar parent ${r.percent >= 100 ? 'done' : r.late ? 'late' : ''}`}
                      style={{ left: `${pos(r.s)}%`, width: `${Math.max(pos(r.e + DAY) - pos(r.s), 1)}%` }}
                      title={`${r.t.name}（配下${rollupOf(r.t)?.leaves}工程の集計）`}>
                      <div className="g-fill" style={{ width: `${r.percent}%` }} />
                    </div>
                  ) : (
                    <div className={`g-bar ${r.t.status === 'done' ? 'done' : r.late ? 'late' : ''}`}
                      style={{ left: `${pos(r.s)}%`, width: `${Math.max(pos(r.e + DAY) - pos(r.s), 1)}%` }}
                      onPointerDown={(ev) => onBarDown(ev, r.t)}
                      onPointerMove={onBarMove}
                      onPointerUp={onBarUp}
                      onPointerCancel={onBarUp}
                      title={`${r.t.name} ${r.t.plannedStart}〜${r.t.plannedEnd}（ドラッグ=移動 / 右端=伸縮）`}>
                      <div className="g-fill" style={{ width: `${r.t.percent}%` }} />
                      <span className="g-handle" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="muted small g-legend">
            バー＝ドラッグで日程移動、右端をつまむと伸縮（末端工程のみ）。細いバー＝大/中工程の自動集計。赤＝遅延。オレンジ縦線＝今日、細線＝週(月曜)。
          </p>
        </div>
      )}

      <div className="task-list">
        {tasks.length === 0 && (
          <p className="muted empty">「⚡ 工種から一括作成」（見積の大項目→大工程）または「＋ 大工程」で追加してください。⠿をドラッグで並べ替え、「＋子工程」で大→中→小と細分化できます。</p>
        )}
        {flat.map(({ t, depth }) => {
          const ru = rollupOf(t)
          const late = ru
            ? (!!ru.end && ru.end < today && ru.percent < 100)
            : isDelayed(t, today)
          const budget = budgetOf(t.linkedMajorId)
          const dep = t.dependsOnTaskId ? tasks.find((x) => x.id === t.dependsOnTaskId) : undefined
          const depConflict = !!(dep?.plannedEnd && t.plannedStart && t.plannedStart < dep.plannedEnd)
          const isOver = overTask?.id === t.id
          return (
            <div
              className={[
                'task-card',
                late ? 'late' : '',
                !ru && t.status === 'done' ? 'done' : '',
                dragTaskId === t.id ? 'dragging' : '',
                isOver && !overTask!.after ? 'drop-before' : '',
                isOver && overTask!.after ? 'drop-after' : '',
              ].join(' ')}
              style={{ marginLeft: depth * 22 }}
              key={t.id}
              onDragOver={(ev) => onCardDragOver(ev, t)}
              onDrop={(ev) => onCardDrop(ev, t)}
            >
              <div className="t-row1">
                <span className="grab" draggable title="ドラッグで並べ替え（同じ階層内）"
                  onDragStart={(ev) => {
                    setDragTaskId(t.id)
                    ev.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => { setDragTaskId(null); setOverTask(null) }}>⠿</span>
                <span className={`depth-chip d${depth}`}>{DEPTH_LABEL[depth]}</span>
                <TextField className="t-name" value={t.name}
                  onCommit={(v) => updateTask(t.id, { name: v })} />
                {depth === 0 && (
                  <select value={t.linkedMajorId ?? ''}
                    onChange={(e) => updateTask(t.id, { linkedMajorId: e.target.value || undefined })}>
                    <option value="">工種と未紐づけ</option>
                    {majors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                {ru ? (
                  <span className="roll-dates" title="配下の工程から自動集計">
                    {ru.start ?? '—'} → {ru.end ?? '—'}
                  </span>
                ) : (
                  <>
                    <input type="date" value={t.plannedStart ?? ''}
                      onChange={(e) => updateTask(t.id, { plannedStart: e.target.value || undefined })} />
                    <span className="arrow">→</span>
                    <input type="date" value={t.plannedEnd ?? ''}
                      onChange={(e) => updateTask(t.id, { plannedEnd: e.target.value || undefined })} />
                  </>
                )}
                {late && <span className="late-badge">遅延</span>}
                {depth < MAX_DEPTH && (
                  <button className="addchild" title="この工程の下に子工程を追加"
                    onClick={() => addTask('新しい工程', { parentTaskId: t.id, linkedMajorId: t.linkedMajorId })}>
                    ＋子工程
                  </button>
                )}
                <button className="del" onClick={() => {
                  if (hasChildren(t.id) && !window.confirm(`「${t.name}」と配下の工程をすべて削除します。よろしいですか？`)) return
                  deleteTask(t.id)
                }} aria-label="削除">🗑</button>
              </div>
              <div className="t-row2">
                {ru ? (
                  <>
                    <div className="roll-bar"><div className="roll-fill" style={{ width: `${ru.percent}%` }} /></div>
                    <b className="pct">{ru.percent.toFixed(0)}%</b>
                    <span className="muted small">配下{ru.leaves}工程の平均</span>
                  </>
                ) : (
                  <>
                    <input type="range" min={0} max={100} step={5} value={t.percent}
                      onChange={(e) => updateTask(t.id, { percent: Number(e.target.value) })} />
                    <b className="pct">{t.percent}%</b>
                    {t.status === 'done'
                      ? <span className="done-badge">✔ 完了</span>
                      : <button className="doneBtn" onClick={() => updateTask(t.id, { percent: 100 })}>✔ 完了に</button>}
                    <TextField className="t-vendor" placeholder="職人/業者" value={t.vendorName ?? ''}
                      onCommit={(v) => updateTask(t.id, { vendorName: v })} />
                  </>
                )}
                {depth === 0 && budget && budget.cost > 0 && (
                  <span className="budget" title="紐づく工種の予定原価 × 進捗%">
                    予算 {yen(budget.cost)}・消化 {yen(budget.cost * (ru ? ru.percent : t.percent) / 100)}
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
