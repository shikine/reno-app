import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import { localToday } from '../schedule/progress'
import type { Payment, PaymentDirection } from '../types/model'

export async function addPayment(
  direction: PaymentDirection,
  patch: Partial<Payment> = {},
): Promise<string> {
  const id = newId()
  const now = nowISO()
  await db.payments.put({
    id, projectId: PROJECT_ID, direction,
    title: direction === 'in' ? '入金' : '支払',
    plannedAmount: 0, status: 'planned',
    createdAt: now, updatedAt: now,
    ...patch,
  })
  return id
}

export async function updatePayment(id: string, patch: Partial<Payment>): Promise<void> {
  await db.payments.update(id, { ...patch, updatedAt: nowISO() })
}

// 済にする＝実績日・実績額を予定から補完
export async function markPaid(p: Payment, paid: boolean): Promise<void> {
  if (paid) {
    await updatePayment(p.id, {
      status: 'paid',
      paidDate: p.paidDate ?? localToday(),
      paidAmount: p.paidAmount ?? p.plannedAmount,
    })
  } else {
    await updatePayment(p.id, { status: 'planned' })
  }
}

export async function deletePayment(id: string): Promise<void> {
  await db.payments.delete(id)
}

// 標準の3回払い（着手30% / 中間40% / 完了=残り）を請負額から生成
export async function createStandardInPlan(total: number): Promise<void> {
  const a = Math.round(total * 0.3)
  const b = Math.round(total * 0.4)
  const c = total - a - b
  await addPayment('in', { title: '着手金（30%）', plannedAmount: a })
  await addPayment('in', { title: '中間金（40%）', plannedAmount: b })
  await addPayment('in', { title: '完了金（残）', plannedAmount: c })
}
