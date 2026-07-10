import type { EstimateItem } from '../types/model'

export const itemSell = (it: EstimateItem) => Math.round((it.quantity ?? 0) * (it.unitPrice ?? 0))
export const itemCost = (it: EstimateItem) => Math.round((it.quantity ?? 0) * (it.costUnitPrice ?? 0))

export interface Totals {
  sell: number
  cost: number
  profit: number
  marginRate: number
  discount: number
  taxable: number
  tax: number
  total: number
}

export function computeTotals(items: EstimateItem[], taxRate: number, discount: number): Totals {
  let sell = 0
  let cost = 0
  for (const it of items) {
    if (it.type !== 'item') continue
    sell += itemSell(it)
    cost += itemCost(it)
  }
  const profit = sell - cost
  const marginRate = sell > 0 ? profit / sell : 0
  const taxable = Math.max(sell - discount, 0)
  const tax = Math.round(taxable * taxRate)
  return { sell, cost, profit, marginRate, discount, taxable, tax, total: taxable + tax }
}

// ある見出しノード配下（子孫）の item を集計
export function subtreeSum(items: EstimateItem[], nodeId: string): { sell: number; cost: number } {
  const childrenOf = new Map<string | null, EstimateItem[]>()
  for (const it of items) {
    const key = it.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(it)
  }
  let sell = 0
  let cost = 0
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (child.type === 'item') {
        sell += itemSell(child)
        cost += itemCost(child)
      } else {
        walk(child.id)
      }
    }
  }
  walk(nodeId)
  return { sell, cost }
}

export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP')
export const pct = (r: number) => (r * 100).toFixed(1) + '%'
