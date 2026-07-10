import { type ChangeEvent, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import DrawingTab from './tabs/DrawingTab'
import EstimateTab from './tabs/EstimateTab'
import ScheduleTab from './tabs/ScheduleTab'
import { db } from './db/db'
import { ensureEstimate, ESTIMATE_ID } from './db/estimateRepo'
import { ensurePlan, PROJECT_ID } from './db/planRepo'
import { computeTotals, pct, yen } from './estimate/estimateTotals'
import { computeOverall } from './schedule/progress'
import { exportAll, importAll } from './db/transfer'
import { backupSupported, chooseBackupDir, getBackupDirName, runBackup } from './db/backup'
import './App.css'

type Tab = 'draw' | 'estimate' | 'schedule'

export default function App() {
  const [tab, setTab] = useState<Tab>('draw')
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

  const estimate = useLiveQuery(() => db.estimates.get(ESTIMATE_ID), [])
  const items = useLiveQuery(
    () => db.estimateItems.where('estimateId').equals(ESTIMATE_ID).toArray(),
    [],
  ) ?? []
  const totals = computeTotals(items, estimate?.taxRate ?? 0.1, estimate?.discount ?? 0)
  const tasks = useLiveQuery(() => db.tasks.where('projectId').equals(PROJECT_ID).toArray(), []) ?? []
  const overall = computeOverall(tasks, items)
  const project = useLiveQuery(() => db.projects.get(PROJECT_ID), [])

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
          <div className="chip"><span>見積(請負)</span><b>{yen(totals.total)}</b></div>
          <div className="chip"><span>予定原価</span><b>{yen(totals.cost)}</b></div>
          <div className="chip good"><span>粗利 {pct(totals.marginRate)}</span><b>{yen(totals.profit)}</b></div>
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
      </nav>

      <div className="tab-body">
        <div className="pane" style={{ display: tab === 'draw' ? 'flex' : 'none' }}><DrawingTab onGoEstimate={() => setTab('estimate')} /></div>
        <div className="pane" style={{ display: tab === 'estimate' ? 'flex' : 'none' }}><EstimateTab /></div>
        <div className="pane" style={{ display: tab === 'schedule' ? 'flex' : 'none' }}><ScheduleTab /></div>
      </div>
    </div>
  )
}
