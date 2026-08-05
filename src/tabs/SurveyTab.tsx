import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import { pickScope } from '../db/estimateRepo'
import { computeTotals, itemSell, yen } from '../estimate/estimateTotals'
import type { EstimateItem } from '../types/model'
import { QUESTIONS, SURVEY_TITLE, buildSummary, type Question } from '../survey/questions'
import { cloudReady, liffReady } from '../cloud/config'
import { getLineUser, initialView, ensureLogin, isLineLoggedIn } from '../cloud/liff'
import {
  addSurvey, listSurveys, saveEstimate, listEstimates, getEstimate,
  type SurveyRecord, type EstimateSummary, type EstimateSnapshot,
} from '../cloud/api'
import './SurveyTab.css'

type View = 'record' | 'list' | 'estimate'

export default function SurveyTab() {
  const project = useLiveQuery(() => db.projects.get(PROJECT_ID), [])
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

      {view === 'record' && <RecordForm defaultProject={project?.name ?? ''} defaultCustomer={project?.customerName ?? ''} onDone={() => setView('list')} />}
      {view === 'list' && <RecordList projectName={project?.name} />}
      {view === 'estimate' && <EstimateRecall />}
    </div>
  )
}

// ---- 記録する（アンケート入力） ----

function RecordForm({ defaultProject, defaultCustomer, onDone }: {
  defaultProject: string; defaultCustomer: string; onDone: () => void
}) {
  const lineUser = getLineUser()
  const [projectName, setProjectName] = useState(defaultProject)
  const [customerName, setCustomerName] = useState(defaultCustomer)
  const [respondent, setRespondent] = useState(lineUser?.displayName ?? '')
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { setProjectName(defaultProject) }, [defaultProject])
  useEffect(() => { setCustomerName(defaultCustomer) }, [defaultCustomer])

  const setAnswer = (id: string, v: unknown) => setAnswers((a) => ({ ...a, [id]: v }))

  const submit = async () => {
    for (const q of QUESTIONS) {
      if (q.required && !answers[q.id]) { setMsg(`「${q.label}」は必須です`); return }
    }
    setSaving(true); setMsg('')
    try {
      await addSurvey({
        projectName, customerName, respondent,
        summary: buildSummary(answers), answers,
      })
      setMsg('保存しました。記録一覧に追加されました。')
      setAnswers({})
      setTimeout(onDone, 600)
    } catch (e) {
      setMsg('保存に失敗: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="survey-form">
      <h3>{SURVEY_TITLE}</h3>
      <div className="survey-fixed">
        <label>案件名<input value={projectName} onChange={(e) => setProjectName(e.target.value)} /></label>
        <label>顧客名<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label>
        <label>調査担当<input value={respondent} onChange={(e) => setRespondent(e.target.value)} /></label>
      </div>

      {QUESTIONS.map((q) => (
        <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
      ))}

      {msg && <div className="survey-msg">{msg}</div>}
      <button className="survey-submit" disabled={saving} onClick={submit}>
        {saving ? '保存中…' : 'この内容で記録する'}
      </button>
    </div>
  )
}

function QuestionField({ q, value, onChange }: { q: Question; value: unknown; onChange: (v: unknown) => void }) {
  const label = <span className="q-label">{q.label}{q.required && <em> *</em>}</span>

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
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<EstimateSnapshot | null>(null)

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

  const openDetail = async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id); setDetail(null)
    try { setDetail(await getEstimate(id)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="survey-list">
      <div className="survey-list-head">
        <button onClick={pushCurrent} disabled={busy}>{busy ? '保存中…' : '⬆ 今の見積をクラウドに保存'}</button>
        <button onClick={load}>↻ 更新</button>
      </div>
      {msg && <div className="survey-msg">{msg}</div>}
      {err && <div className="survey-msg err">{err}</div>}
      {!rows && !err && <div className="survey-msg">読み込み中…</div>}
      {rows && rows.length === 0 && <div className="survey-msg">まだクラウドに保存された見積がありません。</div>}
      {rows?.map((r) => (
        <div key={r.id} className="survey-card">
          <div className="survey-card-head clickable" onClick={() => openDetail(r.id)}>
            <b>{r.label || r.type} <span className="badge">{typeLabel(r.type)}</span></b>
            <span className="survey-amount">{yen(r.total)}</span>
          </div>
          <div className="survey-card-sub">
            <span>{r.projectName || '—'}</span>
            <span>粗利 {yen(r.sell - r.cost)}</span>
            <span className="survey-when">{fmtDateTime(r.savedAt)}</span>
          </div>
          {openId === r.id && (
            <div className="survey-detail">
              {!detail && <div className="survey-msg">読み込み中…</div>}
              {detail?.data.items?.length ? (
                <table className="survey-items">
                  <tbody>
                    {detail.data.items.map((it, i) => (
                      <tr key={i} className={`lv${it.depth} ${it.type}`}>
                        <td className="nm" style={{ paddingLeft: 6 + it.depth * 14 }}>{it.name}</td>
                        <td className="qt">{it.type === 'item' ? `${it.quantity ?? ''}${it.unit ?? ''}` : ''}</td>
                        <td className="am">{it.type === 'item' ? yen(it.amount ?? 0) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : detail ? <div className="survey-msg">明細なし</div> : null}
            </div>
          )}
        </div>
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
