import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import PlanCanvas from '../drawing/PlanCanvas'
import type { EditableRoom, Tool, VertexRef } from '../drawing/editorTypes'
import type { QuantityType, Takeoff, Vec } from '../types/model'
import { dist, pointAtLength, polygonAreaM2, roundMm } from '../drawing/geometry'
import { ensurePlan, exportPlanJSON, roomsFromGeometry, savePlan } from '../db/planRepo'
import { db, newId } from '../db/db'
import { ESTIMATE_ID, sendToEstimate } from '../db/estimateRepo'

const PITCHES = [910, 455, 303, 100]

const QT_DEFAULT_NAME: Record<string, string> = {
  floor_area: '床 仕上げ',
  ceiling_area: '天井 仕上げ',
  wall_area: '壁 クロス',
}
const QT_LABEL: Record<string, string> = {
  floor_area: '床面積',
  ceiling_area: '天井面積',
  wall_area: '壁面積',
  perimeter: '外周',
  count: '箇所',
}

interface SendRow {
  takeoff: Takeoff
  checked: boolean
  name: string
}

interface Props {
  onGoEstimate?: () => void
}

export default function DrawingTab({ onGoEstimate }: Props) {
  const [rooms, setRooms] = useState<EditableRoom[]>([])
  const [draft, setDraft] = useState<Vec[]>([])
  const [tool, setTool] = useState<Tool>('draw')
  const [gridPitch, setGridPitch] = useState(910)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [wallThickness, setWallThickness] = useState(120)
  const [selected, setSelected] = useState<VertexRef | null>(null)
  const [fitToken, setFitToken] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle')
  const [loaded, setLoaded] = useState(false)
  const roomSeq = useRef(1)

  // 見積へ送るダイアログ
  const [sendRoom, setSendRoom] = useState<EditableRoom | null>(null)
  const [sendRows, setSendRows] = useState<SendRow[]>([])
  const [sendMajor, setSendMajor] = useState('内装工事')
  const [toast, setToast] = useState<string | null>(null)

  const majors = useLiveQuery(
    () => db.estimateItems.where('estimateId').equals(ESTIMATE_ID).and((i) => i.type === 'major').toArray(),
    [],
  ) ?? []

  useEffect(() => {
    let alive = true
    ;(async () => {
      const plan = await ensurePlan()
      if (!alive) return
      const loadedRooms = roomsFromGeometry(plan.geometry)
      setRooms(loadedRooms)
      roomSeq.current = loadedRooms.length + 1
      setGridPitch(plan.geometry.gridPitchMm || 910)
      setWallThickness(plan.geometry.wallThicknessMm || 120)
      setLoaded(true)
      setTimeout(() => setFitToken((t) => t + 1), 50)
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    setSaveState('dirty')
    const t = setTimeout(async () => {
      setSaveState('saving')
      await savePlan(rooms, { gridPitchMm: gridPitch, wallThicknessMm: wallThickness })
      setSaveState('saved')
    }, 600)
    return () => clearTimeout(t)
  }, [rooms, gridPitch, wallThickness, loaded])

  const addPoint = (mm: Vec) => setDraft((d) => [...d, mm])
  const undoPoint = () => setDraft((d) => d.slice(0, -1))
  const cancelDraft = () => setDraft([])

  const closeDraft = () => {
    if (draft.length < 3) return
    const room: EditableRoom = { id: newId(), name: `部屋${roomSeq.current++}`, vertices: draft }
    setRooms((rs) => [...rs, room])
    setDraft([])
  }

  const moveVertex = (roomId: string, idx: number, mm: Vec) => {
    setRooms((rs) => rs.map((r) => {
      if (r.id !== roomId) return r
      const v = r.vertices.slice()
      v[idx] = mm
      return { ...r, vertices: v }
    }))
  }

  const setEdgeLength = (roomId: string, vIdx: number, neighborIdx: number, newLen: number) => {
    setRooms((rs) => rs.map((r) => {
      if (r.id !== roomId) return r
      const v = r.vertices.slice()
      v[vIdx] = pointAtLength(v[neighborIdx], v[vIdx], newLen)
      return { ...r, vertices: v }
    }))
  }

  const renameRoom = (roomId: string, name: string) =>
    setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, name } : r)))

  const deleteRoom = (roomId: string) => {
    setRooms((rs) => rs.filter((r) => r.id !== roomId))
    setSelected(null)
  }

  const doExport = async () => {
    const json = await exportPlanJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'plan-existing.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const totalArea = useMemo(() => rooms.reduce((s, r) => s + polygonAreaM2(r.vertices), 0), [rooms])
  const selectedRoom = selected ? rooms.find((r) => r.id === selected.roomId) : undefined

  // 部屋→見積へ送る：保存を即時フラッシュしてから Takeoff を読む
  const openSend = async (room: EditableRoom) => {
    setSaveState('saving')
    await savePlan(rooms, { gridPitchMm: gridPitch, wallThicknessMm: wallThickness })
    setSaveState('saved')
    const tks = await db.takeoffs
      .where('[sourceType+sourceId]').equals(['room', room.id]).toArray()
    const order: QuantityType[] = ['floor_area', 'wall_area', 'ceiling_area']
    tks.sort((a, b) => order.indexOf(a.quantityType) - order.indexOf(b.quantityType))
    setSendRows(tks.map((t) => ({
      takeoff: t,
      checked: t.quantityType !== 'ceiling_area',
      name: `${room.name} ${QT_DEFAULT_NAME[t.quantityType] ?? t.quantityType}`,
    })))
    setSendRoom(room)
  }

  const doSend = async () => {
    if (!sendRoom) return
    const entries = sendRows.filter((r) => r.checked).map((r) => ({
      takeoffId: r.takeoff.id,
      name: r.name,
      unit: r.takeoff.unit === 'm2' ? '㎡' : r.takeoff.unit,
      quantity: r.takeoff.value,
    }))
    if (entries.length === 0) { setSendRoom(null); return }
    const { added, skipped } = await sendToEstimate(sendMajor.trim() || '内装工事', sendRoom.name, entries)
    setSendRoom(null)
    setToast(`見積に ${added} 項目追加しました${skipped > 0 ? `（${skipped}件は取込済みのためスキップ）` : ''}`)
    setTimeout(() => setToast(null), 6000)
  }

  return (
    <>
      <div className="toolbar">
        <div className="group">
          <button className={tool === 'draw' ? 'on' : ''} onClick={() => setTool('draw')}>✏️ 壁を描く</button>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>◇ 選択・移動</button>
          <button className={tool === 'pan' ? 'on' : ''} onClick={() => setTool('pan')}>✋ 手のひら</button>
        </div>
        <div className="group">
          <label><input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} /> スナップ</label>
          <select value={gridPitch} onChange={(e) => setGridPitch(Number(e.target.value))}>
            {PITCHES.map((p) => <option key={p} value={p}>{p}mm グリッド</option>)}
          </select>
          <label><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> グリッド表示</label>
        </div>
        <div className="group">
          <label>壁厚 <input type="number" value={wallThickness} min={0} step={10}
            onChange={(e) => setWallThickness(Number(e.target.value))} style={{ width: 64 }} />mm</label>
        </div>
        <div className="group">
          <button onClick={() => setFitToken((t) => t + 1)}>⤢ 全体表示</button>
        </div>
        {draft.length > 0 && (
          <div className="group draft">
            <span>作図中 {draft.length}点</span>
            <button onClick={undoPoint} disabled={draft.length === 0}>↶ 1点戻す</button>
            <button onClick={closeDraft} disabled={draft.length < 3}>■ 閉じて部屋作成</button>
            <button onClick={cancelDraft}>✕ 取消</button>
          </div>
        )}
        <div className="group save-ind" data-state={saveState}>
          {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '保存済み' : saveState === 'dirty' ? '未保存' : ''}
        </div>
      </div>

      <div className="main">
        <div className="canvas-wrap">
          <PlanCanvas
            rooms={rooms} draft={draft} tool={tool} gridPitch={gridPitch}
            snapEnabled={snapEnabled} showGrid={showGrid} wallThicknessMm={wallThickness}
            selected={selected} onDrawTap={addPoint} onCloseDraft={closeDraft}
            onSelectVertex={setSelected} onMoveVertex={moveVertex} fitToken={fitToken}
          />
          {tool === 'draw' && (
            <div className="hint">
              グリッドをタップで壁の頂点を追加 → 3点以上で始点付近をタップ、または「閉じて部屋作成」で部屋になります。
            </div>
          )}
        </div>

        <aside className="inspector">
          <h3>部屋一覧</h3>
          <div className="total">合計床面積 <b>{totalArea.toFixed(2)} ㎡</b></div>
          {rooms.length === 0 && <p className="muted">まだ部屋がありません。壁を描いて閉じると面積が出ます。</p>}
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id} className={selected?.roomId === r.id ? 'sel' : ''}>
                <input value={r.name} onChange={(e) => renameRoom(r.id, e.target.value)} />
                <span className="area">{polygonAreaM2(r.vertices).toFixed(2)} ㎡</span>
                <button className="send" onClick={() => openSend(r)} title="見積に送る">📤</button>
                <button className="del" onClick={() => deleteRoom(r.id)} aria-label="削除">🗑</button>
              </li>
            ))}
          </ul>

          {selectedRoom && selected && (
            <div className="vertex-edit">
              <h4>選択中：{selectedRoom.name} の頂点 #{selected.vertexIndex + 1}</h4>
              <p className="muted">頂点をドラッグで移動、または隣り合う辺の寸法を手入力できます。</p>
              {(() => {
                const n = selectedRoom.vertices.length
                const i = selected.vertexIndex
                const prev = (i - 1 + n) % n
                const next = (i + 1) % n
                const lenPrev = roundMm(dist(selectedRoom.vertices[i], selectedRoom.vertices[prev]))
                const lenNext = roundMm(dist(selectedRoom.vertices[i], selectedRoom.vertices[next]))
                return (
                  <div className="edge-inputs">
                    <label>前の辺 <input type="number" value={lenPrev} step={10}
                      onChange={(e) => setEdgeLength(selectedRoom.id, i, prev, Number(e.target.value))} />mm</label>
                    <label>次の辺 <input type="number" value={lenNext} step={10}
                      onChange={(e) => setEdgeLength(selectedRoom.id, i, next, Number(e.target.value))} />mm</label>
                  </div>
                )
              })()}
            </div>
          )}

          <div className="export">
            <button onClick={doExport}>⬇ 図面JSONをエクスポート</button>
            <p className="muted small">データモデル通りに Plan.geometry ＋ Room/Wall 行として IndexedDB に保存されています。</p>
          </div>
        </aside>
      </div>

      {sendRoom && (
        <div className="modal-overlay" onClick={() => setSendRoom(null)}>
          <div className="send-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>「{sendRoom.name}」を見積に送る</h3>
            <label className="major-pick">
              大項目（工種）
              <input list="major-list" value={sendMajor} onChange={(e) => setSendMajor(e.target.value)} />
              <datalist id="major-list">
                {majors.map((m) => <option key={m.id} value={m.name} />)}
              </datalist>
            </label>
            <p className="muted small">中項目は部屋名「{sendRoom.name}」として作成されます。数量は現在の図面から拾ったスナップショットです。</p>
            <div className="send-rows">
              {sendRows.map((row, i) => (
                <div className="send-row" key={row.takeoff.id}>
                  <label className="chk">
                    <input type="checkbox" checked={row.checked}
                      onChange={(e) => setSendRows((rs) => rs.map((r, j) => j === i ? { ...r, checked: e.target.checked } : r))} />
                    <span className="qt">{QT_LABEL[row.takeoff.quantityType] ?? row.takeoff.quantityType}</span>
                  </label>
                  <input className="nm" value={row.name}
                    onChange={(e) => setSendRows((rs) => rs.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                  <span className="qty">{row.takeoff.value.toFixed(2)} ㎡</span>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button onClick={() => setSendRoom(null)}>キャンセル</button>
              <button className="primary" onClick={doSend}
                disabled={sendRows.every((r) => !r.checked)}>
                見積に追加（{sendRows.filter((r) => r.checked).length}件）
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast}</span>
          {onGoEstimate && <button onClick={() => { setToast(null); onGoEstimate() }}>見る →</button>}
        </div>
      )}
    </>
  )
}
