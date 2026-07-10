import type { EstimateItem, Task } from '../types/model'
import { subtreeSum } from '../estimate/estimateTotals'

// ローカルタイムの今日 (YYYY-MM-DD)。ISOString(UTC)だと日本時間の朝にズレるため使わない。
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const isDelayed = (t: Task, today: string) =>
  !!t.plannedEnd && t.plannedEnd < today && t.status !== 'done'

export interface OverallProgress {
  percent: number   // 0..100（予算加重平均）
  delayed: number   // 遅延タスク数
  done: number
  total: number
}

// 案件全体の進捗。
// 重み = 紐づく工種(大項目)の予定原価。未紐づけ/予算0のタスクは
// 「紐づき済みタスクの平均予算」で加重（全タスク未紐づけなら等重量）。
export function computeOverall(tasks: Task[], items: EstimateItem[]): OverallProgress {
  const today = localToday()
  const delayed = tasks.filter((t) => isDelayed(t, today)).length
  const done = tasks.filter((t) => t.status === 'done').length
  if (tasks.length === 0) return { percent: 0, delayed, done, total: 0 }

  const weights = tasks.map((t) =>
    t.linkedMajorId ? subtreeSum(items, t.linkedMajorId).cost : 0,
  )
  const positive = weights.filter((w) => w > 0)
  const fallback = positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : 1

  let num = 0
  let den = 0
  tasks.forEach((t, i) => {
    const w = weights[i] > 0 ? weights[i] : fallback
    num += t.percent * w
    den += w
  })
  return { percent: den > 0 ? num / den : 0, delayed, done, total: tasks.length }
}
