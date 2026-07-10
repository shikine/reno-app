import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import type { Estimate, EstimateItem, EstimateItemType } from '../types/model'

export const ESTIMATE_ID = 'demo-estimate-1'
export const DEFAULT_MARGIN = 0.2

export async function ensureEstimate(): Promise<Estimate> {
  const ex = await db.estimates.get(ESTIMATE_ID)
  if (ex) return ex
  const now = nowISO()
  const est: Estimate = {
    id: ESTIMATE_ID, projectId: PROJECT_ID, createdAt: now, updatedAt: now,
    type: 'quote', label: '初回見積', revisionNo: 1, status: 'draft',
    isCurrent: true, taxRate: 0.1, discount: 0,
  }
  await db.estimates.put(est)
  return est
}

async function nextSort(parentId: string | null): Promise<number> {
  const sibs = await db.estimateItems.where('estimateId').equals(ESTIMATE_ID).toArray()
  const same = sibs.filter((s) => s.parentId === parentId)
  return same.length ? Math.max(...same.map((s) => s.sortNo)) + 1 : 0
}

export async function addNode(
  type: EstimateItemType,
  parentId: string | null,
  name: string,
  margin = DEFAULT_MARGIN,
): Promise<string> {
  const now = nowISO()
  const id = newId()
  const base: EstimateItem = {
    id, estimateId: ESTIMATE_ID, parentId, type, sortNo: await nextSort(parentId),
    name, createdAt: now, updatedAt: now,
  }
  if (type === 'item') {
    base.unit = '式'
    base.quantity = 1
    base.costUnitPrice = 0
    base.marginRate = margin
    base.unitPrice = 0
  }
  await db.estimateItems.put(base)
  return id
}

export async function updateNode(id: string, patch: Partial<EstimateItem>): Promise<void> {
  await db.estimateItems.update(id, { ...patch, updatedAt: nowISO() })
}

// item の1フィールド編集。原価/粗利率/売単価は相互に整合を取る。
export async function editItemField(
  item: EstimateItem,
  field: 'name' | 'spec' | 'unit' | 'quantity' | 'costUnitPrice' | 'marginRate' | 'unitPrice',
  value: string | number,
): Promise<void> {
  const cost = item.costUnitPrice ?? 0
  const margin = item.marginRate ?? 0
  let patch: Partial<EstimateItem> = {}
  switch (field) {
    case 'name': case 'spec': case 'unit':
      patch = { [field]: String(value) }
      break
    case 'quantity':
      patch = { quantity: Number(value) }
      break
    case 'costUnitPrice': {
      const c = Number(value)
      patch = { costUnitPrice: c, unitPrice: margin < 1 ? Math.round(c / (1 - margin)) : c }
      break
    }
    case 'marginRate': {
      const m = Number(value)
      patch = { marginRate: m, unitPrice: m < 1 ? Math.round(cost / (1 - m)) : cost }
      break
    }
    case 'unitPrice': {
      const up = Number(value)
      patch = { unitPrice: up, marginRate: up > 0 ? (up - cost) / up : 0 }
      break
    }
  }
  await updateNode(item.id, patch)
}

export async function deleteNode(id: string): Promise<void> {
  const all = await db.estimateItems.where('estimateId').equals(ESTIMATE_ID).toArray()
  const byParent = new Map<string | null, EstimateItem[]>()
  for (const it of all) {
    if (!byParent.has(it.parentId)) byParent.set(it.parentId, [])
    byParent.get(it.parentId)!.push(it)
  }
  const toDelete: string[] = []
  const collect = (nid: string) => {
    toDelete.push(nid)
    for (const c of byParent.get(nid) ?? []) collect(c.id)
  }
  collect(id)
  await db.estimateItems.bulkDelete(toDelete)
}

export async function updateEstimate(patch: Partial<Estimate>): Promise<void> {
  await db.estimates.update(ESTIMATE_ID, { ...patch, updatedAt: nowISO() })
}

// ---- 作図 → 見積（拾い送り） ----
// 大項目(majorName)・中項目(sectionName=部屋名)を探して無ければ作成し、
// Takeoff を参照する明細を追加する。数量は取込時点のスナップショット。
// 同じ Takeoff を既に参照する明細があればスキップ（二重計上防止）。
export interface SendEntry {
  takeoffId: string
  name: string
  unit: string
  quantity: number
}

export async function sendToEstimate(
  majorName: string,
  sectionName: string,
  entries: SendEntry[],
  margin = DEFAULT_MARGIN,
): Promise<{ added: number; skipped: number }> {
  await ensureEstimate()
  const all = await db.estimateItems.where('estimateId').equals(ESTIMATE_ID).toArray()

  let major = all.find((i) => i.type === 'major' && i.name === majorName)
  if (!major) {
    const id = await addNode('major', null, majorName)
    major = (await db.estimateItems.get(id))!
  }
  let section = all.find((i) => i.type === 'section' && i.parentId === major!.id && i.name === sectionName)
  if (!section) {
    const id = await addNode('section', major.id, sectionName)
    section = (await db.estimateItems.get(id))!
  }

  let added = 0
  let skipped = 0
  for (const e of entries) {
    const dup = all.find((i) => i.type === 'item' && i.sourceTakeoffId === e.takeoffId)
    if (dup) { skipped++; continue }
    const id = await addNode('item', section.id, e.name, margin)
    await db.estimateItems.update(id, {
      unit: e.unit,
      quantity: Math.round(e.quantity * 100) / 100,
      sourceTakeoffId: e.takeoffId,
      updatedAt: nowISO(),
    })
    added++
  }
  return { added, skipped }
}
