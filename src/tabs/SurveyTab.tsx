import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import { pickScope } from '../db/estimateRepo'
import { computeTotals, itemSell, yen } from '../estimate/estimateTotals'
import type { EstimateItem } from '../types/model'
import {
  QUESTIONS, SURVEY_TITLE, FIXED_PROJECT, ATTEND_SLOTS, CATEGORIES, questionsFor,
  buildSummary, overallProgress, formatAttendance, formatStageProgress, type Question,
} from '../survey/questions'
import { cloudReady, liffReady } from '../cloud/config'
import { getLineUser, initialView, ensureLogin, isLineLoggedIn } from '../cloud/liff'
import { compressImage, photoThumb, photoOpen } from '../cloud/image'
import GanttView from './GanttView'
import {
  addSurvey, updateSurvey, deleteSurvey, listSurveys, saveEstimate, listEstimates, getEstimate,
  type SurveyRecord, type EstimateSummary, type EstimateSnapshot,
} from '../cloud/api'
import './SurveyTab.css'

type View = 'record' | 'list' | 'gantt' | 'estimate'

export default function SurveyTab() {
  const [view, setView] = useState<View>(() => initialView() ?? 'record')
  const [editing, setEditing] = useState<SurveyRecord | null>(null)
  const lineUser = getLineUser()

  if (!cloudReady()) {
    return (
      <div className="survey-tab">
        <div className="survey-notice">
          <b>クラウド接続先が未設定です。</b>
          <p>
            <code>app/gas/Code.gs</code> をスプレッドシートにデプロイし、発行URLとトークンを
            <code>.env</code> の <code>VITE_GAS_URL</code> / <code>VITE_GAS_TOKEN</code> に設定してください。
            手順は <code>docs/08_LINE連携_構築手順.md</code> にまとめてあります。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="survey-tab">
      <nav className="survey-seg no-print">
        <button className={view === 'record' ? 'on' : ''} onClick={() => { setEditing(null); setView('record') }}>記録する</button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>記録一覧</button>
        <button className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}>ガント</button>
        <button className={view === 'estimate' ? 'on' : ''} onClick={() => setView('estimate')}>見積呼出</button>
      </nav>
      {lineUser ? (
        <div className="survey-line-user">
          LINE: {lineUser.displayName} さん
          <small className="survey-uid">設定用ID: {lineUser.userId}</small>
        </div>
      ) : liffReady() && !isLineLoggedIn() ? (
        <div className="survey-line-user">
          <button className="survey-login" onClick={() => ensureLogin()}>LINEでログイン</button>
        </div>
      ) : null}

      {view === 'record' && <RecordForm key={editing?.id ?? 'new'} editRecord={editing} onDone={() => { setEditing(null); setView('list') }} />}
      {view === 'list' && <RecordList projectName={FIXED_PROJECT} onEdit={(r) => { setEditing(r); setView('record') }} />}
      {view === 'gantt' && <GanttView projectName={FIXED_PROJECT} />}
      {view === 'estimate' && <EstimateRecall />}
    </div>
  )
}

// ---- 記録する（1問ずつのアンケート・ウィザード） ----

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 見積の項目は「一度読めたら固定」：端末にキャッシュし、以後はキャッシュ優先。
// 変更があってクラウドに再保存されたら、次回取得時にキャッシュを更新する。
const WORK_CACHE_KEY = 'reno.workdata'

function readWorkCache(): { items: string[]; stages: string[] } | null {
  try {
    const c = localStorage.getItem(WORK_CACHE_KEY)
    return c ? JSON.parse(c) : null
  } catch { return null }
}

// クラウド保存済み見積から、作業内容の選択肢（工種/明細）と工程一覧（工種）を取り出す
async function loadWorkData(): Promise<{ items: string[]; stages: string[] }> {
  try {
    const ests = await listEstimates()
    if (ests.length) {
      const pick = ests.find((e) => e.type === 'contract') ?? ests[0]
      const snap = await getEstimate(pick.id)
      const rows = snap?.data.items ?? []
      const items: string[] = []
      const stages: string[] = []
      let major = ''
      for (const it of rows) {
        if (it.type === 'major') { major = it.name; if (major && !stages.includes(major)) stages.push(major) }
        else if (it.type === 'item') items.push(major ? `${major} / ${it.name}` : it.name)
      }
      if (items.length) {
        try { localStorage.setItem(WORK_CACHE_KEY, JSON.stringify({ items, stages })) } catch { /* noop */ }
        return { items, stages }
      }
    }
  } catch { /* オフライン等はキャッシュへ */ }
  return readWorkCache() ?? { items: [], stages: [] }
}

function showAnswer(q: Question, v: unknown): string {
  if (q.type === 'photo') { const n = Array.isArray(v) ? v.length : 0; return n ? `${n}枚` : '—' }
  if (q.type === 'attendance') return formatAttendance(v) || '—'
  if (q.type === 'stageprogress') return formatStageProgress(v) || '—'
  if (Array.isArray(v)) return v.length ? v.join('・') : '—'
  if (isEmpty(v)) return '—'
  return q.type === 'progress' ? `${v}%` : String(v)
}

function RecordForm({ onDone, editRecord }: { onDone: () => void; editRecord?: SurveyRecord | null }) {
  const lineUser = getLineUser()
  const [respondent] = useState(lineUser?.displayName ?? '')
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    if (editRecord) return { ...editRecord.answers }
    const init: Record<string, unknown> = {}
    for (const q of QUESTIONS) {
      if (q.type === 'date' && q.default === 'today') init[q.id] = todayISO()
      else if (q.default) init[q.id] = q.default
    }
    return init
  })
  const [workOptions, setWorkOptions] = useState<string[]>(() => readWorkCache()?.items ?? [])
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { loadWorkData().then((d) => setWorkOptions(d.items)) }, [])

  // 工程進捗の対象＝この日「何をしたか」で選んだ項目のみ（他はマップに残って引き継がれる）
  const selectedItems = Array.isArray(answers.workItems) ? (answers.workItems as string[]) : []

  // 新規作成時のみ、前回の記録から「工程進捗」「来た人」を初期値に引き継ぐ（手間削減）
  useEffect(() => {
    if (editRecord) return
    listSurveys(FIXED_PROJECT).then((rows) => {
      const last = rows[0]?.answers
      if (!last) return
      setAnswers((a) => ({
        ...a,
        stageProgress: { ...((a.stageProgress as object) ?? {}), ...((last.stageProgress as object) ?? {}) },
        workers: (last.workers && typeof last.workers === 'object') ? last.workers : a.workers,
      }))
    }).catch(() => { /* 記録が無ければ既定 */ })
  }, [editRecord])

  // 区分（大工/施主）に応じて出す設問だけに絞る
  const active = questionsFor(answers.category)
  const total = active.length + 1 // 各設問 + 確認
  const stepIdx = Math.min(step, active.length)
  const isReview = stepIdx >= active.length
  const q = isReview ? null : active[stepIdx]

  const setAnswer = (id: string, v: unknown) => setAnswers((a) => ({ ...a, [id]: v }))

  const next = () => {
    setMsg('')
    if (q && q.required && isEmpty(answers[q.id])) { setMsg(`「${q.label}」は必須です`); return }
    setStep(Math.min(stepIdx + 1, total - 1))
  }
  const back = () => { setMsg(''); setStep(Math.max(stepIdx - 1, 0)) }

  const submit = async () => {
    for (const qq of active) {
      if (qq.required && isEmpty(answers[qq.id])) { setMsg(`「${qq.label}」が未入力です`); return }
    }
    setSaving(true); setMsg('')
    try {
      const att = (answers.workers && typeof answers.workers === 'object') ? (answers.workers as Record<string, string>) : {}
      const workerNames = Object.keys(att).filter((k) => att[k]).join('・')
      const who = answers.category === '施主' ? '施主' : (workerNames || respondent)
      const payload = {
        projectName: FIXED_PROJECT, customerName: '', respondent: who,
        summary: buildSummary(answers), answers,
      }
      if (editRecord) await updateSurvey(editRecord.id, payload)
      else await addSurvey(payload)
      setDone(true)
      setTimeout(onDone, 1000)
    } catch (e) {
      setMsg('保存に失敗: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="wiz-done">
        <div className="wiz-done-mark">✓</div>
        <h3>{editRecord ? '更新しました' : '記録しました'}</h3>
        <p>「記録一覧」に反映されました。</p>
      </div>
    )
  }

  return (
    <div className="survey-wizard">
      <div className="wiz-head">
        <span className="wiz-title">{editRecord ? '日報を編集' : SURVEY_TITLE}（{FIXED_PROJECT}）</span>
        <span className="wiz-count">{stepIdx + 1} / {total}</span>
      </div>
      <div className="wiz-bar"><div className="wiz-bar-in" style={{ width: `${((stepIdx + 1) / total) * 100}%` }} /></div>

      <div className="wiz-body">
        {q && (
          <div className="wiz-step">
            <h3 className="wiz-q">{q.label}{q.required && <em className="req"> *</em>}</h3>
            <QuestionField q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} dynamicOptions={workOptions} stages={selectedItems} bare />
          </div>
        )}
        {isReview && (
          <div className="wiz-step">
            <h3 className="wiz-q">内容を確認</h3>
            <div className="wiz-review">
              <div className="rev-row"><span>物件</span><b>{FIXED_PROJECT}</b></div>
              {active.map((qq) => (
                <div key={qq.id} className="rev-row"><span>{qq.label.replace(/（.*?）/g, '')}</span><b>{showAnswer(qq, answers[qq.id])}</b></div>
              ))}
            </div>
          </div>
        )}
      </div>

      {msg && <div className="survey-msg err">{msg}</div>}

      <div className="wiz-nav">
        {stepIdx > 0 && <button className="wiz-back" onClick={back} disabled={saving}>← 戻る</button>}
        {!isReview
          ? <button className="wiz-next" onClick={next}>次へ →</button>
          : <button className="wiz-next" onClick={submit} disabled={saving}>{saving ? '保存中…' : (editRecord ? 'この内容で更新する' : 'この内容で記録する')}</button>}
      </div>
      {!isReview && (
        <button className="wiz-skip" onClick={() => { setMsg(''); setStep(total - 1) }}>変更なし → 確認へスキップ</button>
      )}
    </div>
  )
}

function QuestionField({ q, value, onChange, bare, dynamicOptions, stages }: {
  q: Question; value: unknown; onChange: (v: unknown) => void
  bare?: boolean; dynamicOptions?: string[]; stages?: string[]
}) {
  const label = bare ? null : <span className="q-label">{q.label}{q.required && <em> *</em>}</span>

  // 区分（大工／施主）：大きな2択ボタン
  if (q.type === 'category') {
    return <div className="q-field">{label}
      <div className="cat-choices">
        {(q.options ?? CATEGORIES).map((o) => (
          <button key={o} type="button" className={`cat-btn ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>
            {o === '施主' ? '🏠 施主' : '🔨 大工'}
          </button>
        ))}
      </div>
    </div>
  }

  if (q.type === 'time') {
    return <label className="q-field">{label}
      <input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </label>
  }

  // 来た人：人ごとに 午前/午後/全日（なしはタップで解除）
  if (q.type === 'attendance') {
    const map = (value && typeof value === 'object') ? (value as Record<string, string>) : {}
    const setSlot = (name: string, slot: string) => {
      const next = { ...map }
      if (next[name] === slot) delete next[name] // 同じをもう一度で解除
      else next[name] = slot
      onChange(next)
    }
    return <div className="q-field">{label}
      <div className="attend-list">
        {(q.options ?? []).map((name) => (
          <div key={name} className={`attend-row ${map[name] ? 'on' : ''}`}>
            <span className="attend-name">{name}</span>
            <span className="attend-slots">
              {ATTEND_SLOTS.map((s) => (
                <button key={s} type="button" className={map[name] === s ? 'on' : ''} onClick={() => setSlot(name, s)}>{s}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  }

  // 現場写真（最大3枚・圧縮してdata URL化。保存時にDriveへ）
  if (q.type === 'photo') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    const MAX = 3
    const addFiles = async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const room = MAX - arr.length
      const picked = Array.from(files).slice(0, room)
      try {
        const compressed = await Promise.all(picked.map((f) => compressImage(f)))
        onChange([...arr, ...compressed])
      } catch { /* 圧縮失敗は無視 */ }
    }
    return <div className="q-field">{label}
      <div className="photo-grid">
        {arr.map((p, i) => (
          <div key={i} className="photo-thumb">
            <img src={photoThumb(p)} alt="" />
            <button type="button" onClick={() => onChange(arr.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {arr.length < MAX && (
          <label className="photo-add">＋写真
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
          </label>
        )}
      </div>
      <div className="q-hint">最大{MAX}枚。撮影/選択すると自動で圧縮して保存します。</div>
    </div>
  }

  // 工程ごとの進捗（前回値を引き継いで更新）
  if (q.type === 'stageprogress') {
    const list = stages ?? []
    const map = (value && typeof value === 'object') ? (value as Record<string, number>) : {}
    if (list.length === 0) {
      return <div className="q-field">{label}
        <div className="q-hint">前の「何をしたか」で項目を選ぶと、その項目だけ進捗%を入力できます。</div>
      </div>
    }
    const setPct = (stage: string, pct: number) => onChange({ ...map, [stage]: pct })
    return <div className="q-field">{label}
      <div className="stage-list">
        {list.map((stage) => {
          const n = Math.max(0, Math.min(100, Number(map[stage] ?? 0)))
          return (
            <div key={stage} className={`stage-row ${n >= 100 ? 'done' : ''}`}>
              <div className="stage-row-top"><span className="stage-name">{stage}</span><b>{n}%{n >= 100 ? ' ✓' : ''}</b></div>
              <input type="range" min={0} max={100} step={5} value={n} onChange={(e) => setPct(stage, Number(e.target.value))} />
            </div>
          )
        })}
      </div>
    </div>
  }

  // 見積の小項目から複数選択（未保存なら自由入力にフォールバック）
  if (q.type === 'workitems') {
    const opts = dynamicOptions ?? []
    if (opts.length === 0) {
      return <div className="q-field">{label}
        <div className="q-hint">見積がまだクラウドに保存されていません。「見積を見る」で保存すると選択肢が出ます。まずは自由入力できます。</div>
        <textarea rows={3} placeholder="やった作業を記入" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      </div>
    }
    const arr = Array.isArray(value) ? (value as string[]) : []
    const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])
    return <div className="q-field">{label}
      <div className="q-checks q-checks-col">
        {opts.map((o) => (
          <label key={o} className={`q-chip q-chip-wide ${arr.includes(o) ? 'on' : ''}`}>
            <input type="checkbox" checked={arr.includes(o)} onChange={() => toggle(o)} />{o}
          </label>
        ))}
      </div>
    </div>
  }

  if (q.type === 'textarea') {
    return <label className="q-field">{label}
      <textarea rows={2} placeholder={q.placeholder} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </label>
  }
  if (q.type === 'select') {
    return <label className="q-field">{label}
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択してください</option>
        {q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  }
  if (q.type === 'multiselect') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])
    return <div className="q-field">{label}
      <div className="q-checks">
        {q.options?.map((o) => (
          <label key={o} className={`q-chip ${arr.includes(o) ? 'on' : ''}`}>
            <input type="checkbox" checked={arr.includes(o)} onChange={() => toggle(o)} />{o}
          </label>
        ))}
      </div>
    </div>
  }
  // text / number / date
  return <label className="q-field">{label}
    <span className="q-inline">
      <input
        type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'}
        placeholder={q.placeholder}
        value={String(value ?? '')}
        onChange={(e) => onChange(q.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      />
      {q.unit && <em className="q-unit">{q.unit}</em>}
    </span>
  </label>
}

// ---- 記録一覧 ----

function RecordList({ projectName, onEdit }: { projectName?: string; onEdit: (r: SurveyRecord) => void }) {
  const [rows, setRows] = useState<SurveyRecord[] | null>(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setErr(''); setRows(null)
    try { setRows(await listSurveys(projectName)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { load() }, [projectName]) // eslint-disable-line react-hooks/exhaustive-deps

  const progOf = (r: SurveyRecord) => overallProgress(r.answers?.stageProgress)
  const current = rows && rows.length > 0 ? progOf(rows[0]) : 0 // 最新（先頭）が現在の進捗

  const remove = async (r: SurveyRecord) => {
    if (!window.confirm(`${fmtDateTime(r.createdAt)} の記録を削除します。よろしいですか？`)) return
    setBusyId(r.id); setErr('')
    try { await deleteSurvey(r.id); await load() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusyId(null) }
  }

  return (
    <div className="survey-list">
      <div className="survey-list-head">
        <span className="survey-filter">物件：{projectName || '—'}</span>
        <button onClick={load}>↻ 更新</button>
      </div>

      {rows && rows.length > 0 && (
        <div className={`prog-head ${current >= 100 ? 'done' : ''}`}>
          <div className="prog-head-top"><span>現在の進捗（工程平均）</span><b>{current}%</b></div>
          <div className="prog-bar"><div className="prog-bar-in" style={{ width: `${current}%` }} /></div>
          {current >= 100 && <div className="prog-clear">✅ 工事完了（クリア）</div>}
        </div>
      )}

      {err && <div className="survey-msg err">{err}</div>}
      {!rows && !err && <div className="survey-msg">読み込み中…</div>}
      {rows && rows.length === 0 && <div className="survey-msg">まだ記録がありません。</div>}
      {rows?.map((r) => {
        const p = progOf(r)
        return (
          <div key={r.id} className="survey-card">
            <div className="survey-card-head">
              <b>{r.respondent || '記録'}</b>
              <span className="survey-when">{fmtDateTime(r.createdAt)}</span>
            </div>
            <div className="survey-card-prog">
              <div className="prog-bar sm"><div className="prog-bar-in" style={{ width: `${p}%` }} /></div>
              <span className="survey-card-prog-val">{p}%</span>
            </div>
            <div className="survey-card-body">{r.summary || '（内容なし）'}</div>
            {Array.isArray(r.answers?.photos) && (r.answers.photos as string[]).length > 0 && (
              <div className="photo-grid list">
                {(r.answers.photos as string[]).map((p, i) => (
                  <a key={i} href={photoOpen(p)} target="_blank" rel="noreferrer" className="photo-thumb">
                    <img src={photoThumb(p)} alt="" />
                  </a>
                ))}
              </div>
            )}
            <div className="survey-card-actions">
              <button onClick={() => onEdit(r)} disabled={busyId === r.id}>✏️ 変更</button>
              <button className="danger" onClick={() => remove(r)} disabled={busyId === r.id}>{busyId === r.id ? '…' : '🗑 削除'}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- 見積呼出 ----

function EstimateRecall() {
  const [rows, setRows] = useState<EstimateSummary[] | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<EstimateSnapshot | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const load = async () => {
    setErr(''); setRows(null)
    try { setRows(await listEstimates()) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { load() }, [])

  // 現在アプリに入っている見積（金額スコープ）をクラウドへ保存
  const pushCurrent = async () => {
    setBusy(true); setMsg('')
    try {
      const estimates = await db.estimates.toArray()
      const allItems = await db.estimateItems.toArray()
      const scope = pickScope(estimates)
      if (scope.length === 0) { setMsg('保存できる見積がありません'); setBusy(false); return }
      const proj = await db.projects.get(PROJECT_ID)
      for (const e of scope) {
        const items = allItems.filter((i) => i.estimateId === e.id)
        const t = computeTotals(items, e.taxRate, e.discount)
        await saveEstimate({
          id: e.id, // 同じ見積は上書き
          projectName: proj?.name ?? '',
          label: e.label, type: e.type,
          total: t.total, sell: t.sell, cost: t.cost,
          data: { taxRate: e.taxRate, discount: e.discount, items: flattenItems(items) },
        })
      }
      setMsg(`${scope.length}件の見積をクラウドに保存しました`)
      await load()
    } catch (e) {
      setMsg('保存に失敗: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }

  const choose = async (id: string) => {
    setSelected(id); setDetail(null); setLoadingDetail(true); setErr('')
    try { setDetail(await getEstimate(id)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setLoadingDetail(false) }
  }
  const backToList = () => { setSelected(null); setDetail(null); setErr('') }

  const itemsTable = (items: NonNullable<EstimateSnapshot['data']['items']>) => (
    <table className="survey-items">
      <tbody>
        {items.map((it, i) => (
          <tr key={i} className={`lv${it.depth} ${it.type}`}>
            <td className="nm" style={{ paddingLeft: 6 + it.depth * 14 }}>{it.name}</td>
            <td className="qt">{it.type === 'item' ? `${it.quantity ?? ''}${it.unit ?? ''}` : ''}</td>
            <td className="am">{it.type === 'item' ? yen(it.amount ?? 0) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  // 結果表示（選んだ見積の内容が「返ってくる」画面）
  if (selected) {
    return (
      <div className="survey-list">
        <button className="wiz-back" onClick={backToList}>← 別の見積を選ぶ</button>
        {loadingDetail && <div className="survey-msg">読み込み中…</div>}
        {err && <div className="survey-msg err">{err}</div>}
        {detail && (
          <div className="est-result">
            <div className="est-result-head">
              <b>{detail.label || typeLabel(detail.type)} <span className="badge">{typeLabel(detail.type)}</span></b>
              <span className="survey-amount">{yen(detail.total)}</span>
            </div>
            <div className="survey-card-sub">
              <span>{detail.projectName || '—'}</span>
              <span>税抜 {yen(detail.sell)}</span>
              <span>原価 {yen(detail.cost)}</span>
              <span>粗利 {yen(detail.sell - detail.cost)}</span>
              <span className="survey-when">{fmtDateTime(detail.savedAt)}</span>
            </div>
            {detail.data.items?.length ? itemsTable(detail.data.items) : <div className="survey-msg">明細なし</div>}
          </div>
        )}
      </div>
    )
  }

  // 質問＋選択肢（どの見積を見るか）
  return (
    <div className="survey-list">
      <div className="survey-list-head">
        <button onClick={pushCurrent} disabled={busy}>{busy ? '保存中…' : '⬆ 今の見積をクラウドに保存'}</button>
        <button onClick={load}>↻ 更新</button>
      </div>
      {msg && <div className="survey-msg">{msg}</div>}
      {err && <div className="survey-msg err">{err}</div>}
      <h3 className="wiz-q">どの見積を見ますか？</h3>
      {!rows && !err && <div className="survey-msg">読み込み中…</div>}
      {rows && rows.length === 0 && (
        <div className="survey-msg">まだクラウドに保存された見積がありません。上の「⬆ 今の見積をクラウドに保存」で登録できます。</div>
      )}
      {rows?.map((r) => (
        <button key={r.id} className="est-choice" onClick={() => choose(r.id)}>
          <span className="est-choice-top">
            <b>{r.label || typeLabel(r.type)}</b>
            <span className="badge">{typeLabel(r.type)}</span>
            <span className="survey-amount">{yen(r.total)}</span>
          </span>
          <span className="est-choice-sub">{r.projectName || '—'} ・ {fmtDateTime(r.savedAt)}</span>
        </button>
      ))}
    </div>
  )
}

// ---- helpers ----

function flattenItems(items: EstimateItem[]): NonNullable<EstimateSnapshot['data']['items']> {
  const childrenOf = new Map<string | null, EstimateItem[]>()
  for (const it of items) {
    if (!childrenOf.has(it.parentId)) childrenOf.set(it.parentId, [])
    childrenOf.get(it.parentId)!.push(it)
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.sortNo - b.sortNo)
  const out: NonNullable<EstimateSnapshot['data']['items']> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const it of childrenOf.get(parentId) ?? []) {
      out.push({
        type: it.type, name: it.name, spec: it.spec,
        unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice,
        amount: it.type === 'item' ? itemSell(it) : undefined,
        depth,
      })
      walk(it.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function typeLabel(t: string): string {
  return t === 'contract' ? '契約' : t === 'change_order' ? '追加変更' : '見積'
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
