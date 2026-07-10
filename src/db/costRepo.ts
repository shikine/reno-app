import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import { localToday } from '../schedule/progress'
import type { Cost } from '../types/model'

export async function addCost(patch: Partial<Cost> = {}): Promise<string> {
  const id = newId()
  const now = nowISO()
  await db.costs.put({
    id, projectId: PROJECT_ID,
    kind: 'material', title: '', amount: 0, incurredAt: localToday(),
    createdAt: now, updatedAt: now,
    ...patch,
  })
  return id
}

export async function updateCost(id: string, patch: Partial<Cost>): Promise<void> {
  await db.costs.update(id, { ...patch, updatedAt: nowISO() })
}

export async function deleteCost(id: string): Promise<void> {
  await db.costs.delete(id)
}
