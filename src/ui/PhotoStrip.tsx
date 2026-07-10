import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, nowISO } from '../db/db'
import { PROJECT_ID } from '../db/planRepo'
import type { Attachment } from '../types/model'
import { TextField } from './fields'

// カメラ写真は数MBあるため、保存前に長辺1600px/JPEGへ縮小して容量を抑える
async function resizeToJpeg(file: File, maxDim = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.82))
}

interface Props {
  targetType: Attachment['targetType']
  targetId: string
  compact?: boolean
}

export function PhotoStrip({ targetType, targetId, compact = false }: Props) {
  const photos = useLiveQuery(
    () => db.attachments.where('[targetType+targetId]').equals([targetType, targetId]).toArray(),
    [targetType, targetId],
  ) ?? []
  const [viewId, setViewId] = useState<string | null>(null)

  const urls = useMemo(
    () => new Map(photos.map((p) => [p.id, URL.createObjectURL(p.blob)])),
    [photos],
  )
  useEffect(() => () => { for (const u of urls.values()) URL.revokeObjectURL(u) }, [urls])

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const f of files) {
      try {
        const blob = await resizeToJpeg(f)
        const now = nowISO()
        await db.attachments.put({
          id: newId(), projectId: PROJECT_ID, targetType, targetId,
          kind: 'photo', blob, createdAt: now, updatedAt: now,
        })
      } catch (err) {
        console.error(err)
        window.alert('写真の取り込みに失敗しました')
      }
    }
  }

  const viewing = photos.find((p) => p.id === viewId)

  return (
    <div className={`photo-strip ${compact ? 'compact' : ''}`}>
      {photos.map((p) => (
        <button className="thumb" key={p.id} onClick={() => setViewId(p.id)} title={p.caption ?? ''}>
          <img src={urls.get(p.id)} alt={p.caption ?? '写真'} />
        </button>
      ))}
      <label className="add-photo" title="写真を追加（カメラ / ファイル）">
        📷{!compact && photos.length === 0 ? ' 写真を追加' : ''}
        <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />
      </label>

      {viewing && (
        <div className="modal-overlay" onClick={() => setViewId(null)}>
          <div className="photo-viewer" onClick={(e) => e.stopPropagation()}>
            <img src={urls.get(viewing.id)} alt="" />
            <div className="pv-bar">
              <TextField placeholder="メモ（例: 解体前 北側壁）" value={viewing.caption ?? ''}
                onCommit={(v) => db.attachments.update(viewing.id, { caption: v, updatedAt: nowISO() })} />
              <button className="pv-del" onClick={async () => {
                if (!window.confirm('この写真を削除しますか？')) return
                await db.attachments.delete(viewing.id)
                setViewId(null)
              }}>🗑 削除</button>
              <button onClick={() => setViewId(null)}>✕ 閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
