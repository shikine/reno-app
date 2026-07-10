import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import { computeTotals } from '../estimate/estimateTotals'
import type { Estimate, EstimateItem, EstimateItemType } from '../types/model'

export const ESTIMATE_ID = 'demo-estimate-1'
export const DEFAULT_MARGIN = 0.2

export async function ensureEstimate(): Promise<Estimate> {
  const ex = await db.estimates.get(ESTIMATE_ID)
  if (ex) return ex
  const any = await db.estimates.toArray()
  if (any.length > 0) return any[0]
  const now = nowISO()
  const est: Estimate = {
    id: ESTIMATE_ID, projectId: PROJECT_ID, createdAt: now, updatedAt: now,
    type: 'quote', label: '初回見積', revisionNo: 1, status: 'draft',
    isCurrent: true, taxRate: 0.1, discount: 0,
  }
  await db.estimates.put(est)
  return est
}

// ---- 版の選定（純関数） ----

// 編集対象＝draft/proposed の最新（追加変更を優先的に拾う）
export function pickEditable(ests: Estimate[]): Estimate | undefined {
  return ests
    .filter((e) => e.status === 'draft' || e.status === 'proposed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

// 金額集計の対象＝契約(＋凍結済み追加変更)。契約前は編集中の見積1本。
export function pickScope(ests: Estimate[]): Estimate[] {
  const contract = ests.find((e) => e.type === 'contract')
  if (contract) {
    return [contract, ...ests.filter((e) => e.type === 'change_order' && e.status === 'locked')]
  }
  const working = pickEditable(ests)
  return working ? [working] : ests.slice(0, 1)
}

// ---- 木の編集 ----

async function nextSort(estimateId: string, parentId: string | null): Promise<number> {
  const sibs = await db.estimateItems.where('estimateId').equals(estimateId).toArray()
  const same = sibs.filter((s) => s.parentId === parentId)
  return same.length ? Math.max(...same.map((s) => s.sortNo)) + 1 : 0
}

export async function addNode(
  estimateId: string,
  type: EstimateItemType,
  parentId: string | null,
  name: string,
  margin = DEFAULT_MARGIN,
): Promise<string> {
  const now = nowISO()
  const id = newId()
  const base: EstimateItem = {
    id, estimateId, parentId, type, sortNo: await nextSort(estimateId, parentId),
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
  const target = await db.estimateItems.get(id)
  if (!target) return
  const all = await db.estimateItems.where('estimateId').equals(target.estimateId).toArray()
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

export async function updateEstimate(estimateId: string, patch: Partial<Estimate>): Promise<void> {
  await db.estimates.update(estimateId, { ...patch, updatedAt: nowISO() })
}

// ---- 版管理：契約確定・追加変更・凍結 ----

// 見積を複製して契約版(locked)を作る。元はsuperseded。
// タスク・実費の明細リンクは新IDへ付け替え、請負金額をProjectへ確定。
export async function confirmContract(quoteId: string): Promise<string> {
  const quote = await db.estimates.get(quoteId)
  if (!quote) throw new Error('見積が見つかりません')
  const now = nowISO()
  const items = await db.estimateItems.where('estimateId').equals(quoteId).toArray()

  const newEstId = newId()
  const idMap = new Map<string, string>()
  for (const it of items) idMap.set(it.id, newId())
  const newItems = items.map((it) => ({
    ...it,
    id: idMap.get(it.id)!,
    estimateId: newEstId,
    parentId: it.parentId ? (idMap.get(it.parentId) ?? null) : null,
    createdAt: now, updatedAt: now,
  }))
  const contract: Estimate = {
    ...quote,
    id: newEstId, type: 'contract', status: 'locked', label: '契約',
    parentEstimateId: quoteId, lockedAt: now, isCurrent: true,
    createdAt: now, updatedAt: now,
  }

  await db.transaction('rw', [db.estimates, db.estimateItems, db.tasks, db.costs, db.projects], async () => {
    await db.estimates.put(contract)
    await db.estimateItems.bulkPut(newItems)
    await db.estimates.update(quoteId, { status: 'superseded', isCurrent: false, updatedAt: now })
    const tasks = await db.tasks.toArray()
    for (const t of tasks) {
      if (t.linkedMajorId && idMap.has(t.linkedMajorId)) {
        await db.tasks.update(t.id, { linkedMajorId: idMap.get(t.linkedMajorId)!, updatedAt: now })
      }
    }
    const costs = await db.costs.toArray()
    for (const c of costs) {
      if (c.estimateItemId && idMap.has(c.estimateItemId)) {
        await db.costs.update(c.id, { estimateItemId: idMap.get(c.estimateItemId)!, updatedAt: now })
      }
    }
    const totals = computeTotals(newItems, contract.taxRate, contract.discount)
    await db.projects.update(quote.projectId, {
      contractAmount: totals.total, status: 'contracted', updatedAt: now,
    })
  })
  return newEstId
}

export async function createChangeOrder(): Promise<string> {
  const ests = await db.estimates.toArray()
  const contract = ests.find((e) => e.type === 'contract')
  if (!contract) throw new Error('先に契約版を確定してください')
  const n = ests.filter((e) => e.type === 'change_order').length + 1
  const id = newId()
  const now = nowISO()
  await db.estimates.put({
    id, projectId: contract.projectId, parentEstimateId: contract.id,
    type: 'change_order', label: `追加変更${n}`, revisionNo: 1,
    status: 'draft', isCurrent: false,
    taxRate: contract.taxRate, discount: 0,
    createdAt: now, updatedAt: now,
  })
  return id
}

export async function lockEstimate(estimateId: string): Promise<void> {
  await db.estimates.update(estimateId, { status: 'locked', lockedAt: nowISO(), updatedAt: nowISO() })
}

// 作図→見積の送り先（編集可能な版。契約後は追加変更を自動作成）
export async function getEditableEstimateId(): Promise<string> {
  const ests = await db.estimates.toArray()
  const editable = pickEditable(ests)
  if (editable) return editable.id
  const contract = ests.find((e) => e.type === 'contract')
  if (contract) return createChangeOrder()
  return (await ensureEstimate()).id
}

// ---- 作図 → 見積（拾い送り） ----
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
): Promise<{ added: number; skipped: number; estimateId: string }> {
  const estimateId = await getEditableEstimateId()
  const all = await db.estimateItems.where('estimateId').equals(estimateId).toArray()

  let major = all.find((i) => i.type === 'major' && i.name === majorName)
  if (!major) {
    const id = await addNode(estimateId, 'major', null, majorName)
    major = (await db.estimateItems.get(id))!
  }
  let section = all.find((i) => i.type === 'section' && i.parentId === major!.id && i.name === sectionName)
  if (!section) {
    const id = await addNode(estimateId, 'section', major.id, sectionName)
    section = (await db.estimateItems.get(id))!
  }

  let added = 0
  let skipped = 0
  for (const e of entries) {
    const dup = all.find((i) => i.type === 'item' && i.sourceTakeoffId === e.takeoffId)
    if (dup) { skipped++; continue }
    const id = await addNode(estimateId, 'item', section.id, e.name, margin)
    await db.estimateItems.update(id, {
      unit: e.unit,
      quantity: Math.round(e.quantity * 100) / 100,
      sourceTakeoffId: e.takeoffId,
      updatedAt: nowISO(),
    })
    added++
  }
  return { added, skipped, estimateId }
}
