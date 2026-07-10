import { db, nowISO } from './db'
import { PLAN_ID, roomsFromGeometry, savePlan } from './planRepo'

// 案件データ全体のエクスポート/インポート（N-4: バックアップ・端末移行用）
const TABLES = [
  'projects', 'plans', 'rooms', 'walls', 'openings',
  'takeoffs', 'estimates', 'estimateItems', 'tasks',
] as const

export const EXPORT_FORMAT = 'reno-app-export'

export async function exportAll(): Promise<string> {
  const dump: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: nowISO(),
  }
  for (const t of TABLES) dump[t] = await db.table(t).toArray()
  return JSON.stringify(dump, null, 1)
}

// 全テーブルを置換。rooms/walls/takeoffs を含まないJSONは plan.geometry から導出する。
export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json) as Record<string, unknown>
  if (data.format !== EXPORT_FORMAT) {
    throw new Error('このファイルはリノベアプリのエクスポート形式ではありません')
  }
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      const rows = data[t]
      if (Array.isArray(rows) && rows.length > 0) await db.table(t).bulkPut(rows)
    }
  })

  const hasRooms = Array.isArray(data.rooms) && (data.rooms as unknown[]).length > 0
  const plan = await db.plans.get(PLAN_ID)
  if (plan && !hasRooms) {
    await savePlan(roomsFromGeometry(plan.geometry), {
      gridPitchMm: plan.geometry.gridPitchMm || 910,
      wallThicknessMm: plan.geometry.wallThicknessMm || 120,
    })
  }
}
