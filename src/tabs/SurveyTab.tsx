import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import { pickScope } from '../db/estimateRepo'
import { computeTotals, itemSell, yen } from '../estimate/estimateTotals'
import type { EstimateItem } from '../types/model'
import { QUESTIONS, SURVEY_TITLE, FIXED_PROJECT, buildSummary, type Question } from '../survey/questions'
import { cloudReady, liffReady } from '../cloud/config'
import { getLineUser, initialView, ensureLogin, isLineLoggedIn } from '../cloud/liff'
import {
  addSurvey, listSurveys, saveEstimate, listEstimates, getEstimate,
  type SurveyRecord, type EstimateSummary, type EstimateSnapshot,
} from '../cloud/api'
import './SurveyTab.css'

type View = 'record' | 'list' | 'estimate'

export default function SurveyTab() {
  const [view, setView] = useState<View>(() => initialView() ?? 'record')
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
        <button className={view === 'record' ? 'on' : ''} onClick={() => setView('record')}>記録する</button>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>記録一覧</button>
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

      {view === 'record' && <RecordForm onDone={() => setView('list')} />}
      {view === 'list' && <RecordList projectName={FIXED_PROJECT} />}
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

// 見積の小項目を「工種 / 明細」の選択肢に変換（クラウド保存済み見積から）
async function loadWorkOptions(): Promise<string[]> {
  try {
    const ests = await listEstimates()
    if (!ests.length) return []
    const pick = ests.find((e) => e.type === 'contract') ?? ests[0]
    const snap = await getEstimate(pick.id)
    const items = snap?.data.items ?? []
    const opts: string[] = []
    let major = ''
    for (const it of items) {
      if (it.type === 'major') major = it.name
      else if (it.type === 'item') opts.push(major ? `${major} / ${it.name}` : it.name)
    }
    return opts
  } catch {
    return []
  }
}

function RecordForm({ onDone }: { onDone: () => void }) {
  const lineUser = getLineUser()
  const [respondent] = useState(lineUser?.displayName ?? '')
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const q of QUESTIONS) {
      if (q.type === 'date' && q.default === 'today') init[q.id] = todayISO()
      else if (q.default) init[q.id] = q.default
    }
    return init
  })
  const [workOptions, setWorkOptions] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { loadWorkOptions().then(setWorkOptions) }, [])

  const total = QUESTIONS.length + 1 // 1..N=各設問, 最後=確認
  const isReview = step === total - 1
  const q = !isReview ? QUESTIONS[step] : null

  const setAnswer = (id: string, v: unknown) => setAnswers((a) => ({ ...a, [id]: v }))

  const next = () => {
    setMsg('')
    if (q && q.required && isEmpty(answers[q.id])) { setMsg(`「${q.label}」は必須です`); return }
    setStep((s) => Math.min(s + 1, total - 1))
  }
  const back = () => { setMsg(''); setStep((s) => Math.max(s - 1, 0)) }

  const submit = async () => {
    for (const qq of QUESTIONS) {
      if (qq.required && isEmpty(answers[qq.id])) { setMsg(`「${qq.label}」が未入力です`); return }
    }
    setSaving(true); setMsg('')
    try {
      const workers = Array.isArray(answers.workers) ? (answers.workers as string[]).join('・') : ''
      await addSurvey({
        projectName: FIXED_PROJECT, customerName: '', respondent: workers || respondent,
        summary: buildSummary(answers), answers,
      })
      setDone(true)
      setTimeout(onDone, 1200)
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
        <h3>記録しました</h3>
        <p>「記録一覧」に追加されました。</p>
      </div>
    )
  }

  return (
    <div className="survey-wizard">
      <div className="wiz-head">
        <span className="wiz-title">{SURVEY_TITLE}（{FIXED_PROJECT}）</span>
        <span className="wiz-count">{step + 1} / {total}</span>
      </div>
      <div className="wiz-bar"><div className="wiz-bar-in" style={{ width: `${((step + 1) / total) * 100}%` }} /></div>

      <div className="wiz-body">
        {q && (
          <div className="wiz-step">
            <h3 className="wiz-q">{q.label}{q.required && <em className="req"> *</em>}</h3>
            <QuestionField q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} dynamicOptions={workOptions} bare />
          </div>
        )}
        {isReview && (
          <div className="wiz-step">
            <h3 className="wiz-q">内容を確認</h3>
            <div className="wiz-review">
              <div className="rev-row"><span>物件</span><b>{FIXED_PROJECT}</b></div>
              {QUESTIONS.map((qq) => {
                const v = answers[qq.id]
                const shown = Array.isArray(v) ? v.join('・') : (isEmpty(v) ? '—' : String(v))
                return <div key={qq.id} className="rev-row"><span>{qq.label.replace(/（.*?）/g, '')}</span><b>{shown}</b></div>
              })}
            </div>
          </div>
        )}
      </div>

      {msg && <div className="survey-msg err">{msg}</div>}

      <div className="wiz-nav">
        {step > 0 && <button className="wiz-back" onClick={back} disabled={saving}>← 戻る</button>}
        {!isReview
          ? <button className="wiz-next" onClick={next}>次へ →</button>
          : <button className="wiz-next" onClick={submit} disabled={saving}>{saving ? '保存中…' : 'この内容で記録する'}</button>}
      </div>
    </div>
  )
}

function QuestionField({ q, value, onChange, bare, dynamicOptions }: {
  q: Question; value: unknown; onChange: (v: unknown) => void; bare?: boolean; dynamicOptions?: string[]
}) {
  const label = bare ? null : <span className="q-label">{q.label}{q.required && <em> *</em>}</span>

  if (q.type === 'time') {
    return <label className="q-field">{label}
      <input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </label>
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

function RecordList({ projectName }: { projectName?: string }) {
  const [rows, setRows] = useState<SurveyRecord[] | null>(null)
  const [err, setErr] = useState('')
  const [onlyThis, setOnlyThis] = useState(true)

  const load = async () => {
    setErr(''); setRows(null)
    try { setRows(await listSurveys(onlyThis ? projectName : undefined)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { load() }, [onlyThis, projectName]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="survey-list">
      <div className="survey-list-head">
        <label className="survey-filter">
          <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} />
          この案件のみ（{projectName || '—'}）
        </label>
        <button onClick={load}>↻ 更新</button>
      </div>
      {err && <div className="survey-msg err">{err}</div>}
      {!rows && !err && <div className="survey-msg">読み込み中…</div>}
      {rows && rows.length === 0 && <div className="survey-msg">まだ記録がありません。</div>}
      {rows?.map((r) => (
        <div key={r.id} className="survey-card">
          <div className="survey-card-head">
            <b>{r.projectName || '（案件名なし）'}</b>
            <span className="survey-when">{fmtDateTime(r.createdAt)}</span>
          </div>
          <div className="survey-card-sub">
            {r.customerName && <span>顧客: {r.customerName}</span>}
            {r.respondent && <span>担当: {r.respondent}</span>}
          </div>
          <div className="survey-card-body">{r.summary || '（内容なし）'}</div>
        </div>
      ))}
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
