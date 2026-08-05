import { type ChangeEvent, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import DrawingTab from './tabs/DrawingTab'
import EstimateTab from './tabs/EstimateTab'
import ScheduleTab from './tabs/ScheduleTab'
import SurveyTab from './tabs/SurveyTab'
import { db } from './db/db'
import { getViewParam } from './cloud/liff'
import { ensureEstimate, pickScope } from './db/estimateRepo'
import { ensurePlan, PROJECT_ID } from './db/planRepo'
import { computeTotals, yen } from './estimate/estimateTotals'
import { computeOverall } from './schedule/progress'
import { exportAll, importAll } from './db/transfer'
import { backupSupported, chooseBackupDir, getBackupDirName, runBackup } from './db/backup'
import './App.css'

type Tab = 'draw' | 'estimate' | 'schedule' | 'survey'

// LINEリッチメニューから ?view=survey/list/estimate で開かれたら最初からアンケートタブを表示
// （LIFFは追加クエリを liff.state に包むことがあるため getViewParam で両対応）
const initialTab = (): Tab => (getViewParam() ? 'survey' : 'draw')

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [backupDir, setBackupDir] = useState<string | null>(null)

  useEffect(() => { ensurePlan(); ensureEstimate() }, [])

  // 自動バックアップ：起動時にフォルダ名を復元、60秒ごと＋画面が隠れた時に実行
  useEffect(() => {
    getBackupDirName().then(setBackupDir)
    const timer = setInterval(() => { runBackup() }, 60_000)
    const onHide = () => { if (document.visibilityState === 'hidden') runBackup() }
    document.addEventListener('visibilitychange', onHide)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onHide) }
  }, [])

  const pickBackupDir = async () => {
    try {
      const name = await chooseBackupDir()
      setBackupDir(name)
      const r = await runBackup(true)
      window.alert(r === 'written'
        ? `バックアップ先を「${name}」に設定し、1回目を保存しました。以後は自動保存されます。`
        : `バックアップ先を「${name}」に設定しました（書き込み結果: ${r}）`)
    } catch {
      /* ユーザーがフォルダ選択をキャンセル */
    }
  }

  const estimates = useLiveQuery(() => db.estimates.toArray(), []) ?? []
  const allItems = useLiveQuery(() => db.estimateItems.toArray(), []) ?? []
  const costs = useLiveQuery(() => db.costs.toArray(), []) ?? []
  const tasks = useLiveQuery(() => db.tasks.where('projectId').equals(PROJECT_ID).toArray(), []) ?? []
  const project = useLiveQuery(() => db.projects.get(PROJECT_ID), [])

  // KPI＝金額スコープ（契約＋凍結済み追加変更 / 契約前は編集中見積）
  const scope = pickScope(estimates)
  const scopeItems = allItems.filter((i) => scope.some((e) => e.id === i.estimateId))
  const agg = scope.reduce((acc, e) => {
    const t = computeTotals(allItems.filter((i) => i.estimateId === e.id), e.taxRate, e.discount)
    return { sell: acc.sell + t.sell, cost: acc.cost + t.cost, total: acc.total + t.total }
  }, { sell: 0, cost: 0, total: 0 })
  const actualCost = costs.reduce((s, c) => s + c.amount, 0)
  const profitLeft = agg.sell - actualCost // 粗利(残)＝税抜売価 − 実績原価
  const hasContract = estimates.some((e) => e.type === 'contract')
  // 進捗は末端工程のみで集計（親工程は配下の集計値のため二重計上しない）
  const leafTasks = tasks.filter((t) => !tasks.some((x) => x.parentTaskId === t.id))
  const overall = computeOverall(leafTasks, scopeItems)

  const doExportAll = async () => {
    const json = await exportAll()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    a.href = url
    a.download = `reno-backup-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImportAll = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!window.confirm('現在のデータをすべて読み込んだ内容に置き換えます。よろしいですか？\n（必要なら先に「⬇保存」でバックアップしてください）')) return
    try {
      await importAll(await file.text())
      window.alert('読み込みました。画面を再読み込みします。')
      window.location.reload()
    } catch (err) {
      window.alert(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="app-name">リノベ案件管理</span>
          <span className="proj">{project?.name ?? ''}</span>
          <span className="io">
            <button onClick={doExportAll} title="全データをJSONで保存（バックアップ）">⬇ 保存</button>
            <label title="JSONを読み込み（全データ置換）">⬆ 読込
              <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImportAll} />
            </label>
            {backupSupported() && (
              <button onClick={pickBackupDir}
                title="自動バックアップ先フォルダを設定（Googleドライブのフォルダを選べばクラウドに同期されます）">
                🗂 {backupDir ? `自動BU: ${backupDir}` : '自動バックアップ'}
              </button>
            )}
          </span>
        </div>
        <div className="kpi">
          <div className="chip" title={hasContract ? '契約＋凍結済み追加変更の税込合計' : '編集中見積の税込合計'}>
            <span>{hasContract ? '請負(契約+追加)' : '見積(税込)'}</span><b>{yen(agg.total)}</b>
          </div>
          <div className="chip"><span>予定原価</span><b>{yen(agg.cost)}</b></div>
          <div className={`chip ${actualCost > agg.cost ? 'warn' : ''}`} title="実費(材料/手間/外注/諸経費)の合計">
            <span>実績原価</span><b>{yen(actualCost)}</b>
          </div>
          <div className="chip good" title="税抜売価 − 実績原価">
            <span>粗利(残)</span><b>{yen(profitLeft)}</b>
          </div>
          <div className={`chip ${overall.delayed > 0 ? 'warn' : ''}`}>
            <span>進捗{overall.delayed > 0 ? ` ⚠遅延${overall.delayed}` : ''}</span>
            <b>{overall.percent.toFixed(0)}%</b>
          </div>
        </div>
      </header>

      <nav className="tabs no-print">
        <button className={tab === 'draw' ? 'on' : ''} onClick={() => setTab('draw')}>作図</button>
        <button className={tab === 'estimate' ? 'on' : ''} onClick={() => setTab('estimate')}>見積・経費</button>
        <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>工程</button>
        <button className={tab === 'survey' ? 'on' : ''} onClick={() => setTab('survey')}>アンケート</button>
      </nav>

      <div className="tab-body">
        <div className="pane" style={{ display: tab === 'draw' ? 'flex' : 'none' }}><DrawingTab onGoEstimate={() => setTab('estimate')} /></div>
        <div className="pane" style={{ display: tab === 'estimate' ? 'flex' : 'none' }}><EstimateTab /></div>
        <div className="pane" style={{ display: tab === 'schedule' ? 'flex' : 'none' }}><ScheduleTab /></div>
        <div className="pane" style={{ display: tab === 'survey' ? 'flex' : 'none' }}><SurveyTab /></div>
      </div>
    </div>
  )
}
