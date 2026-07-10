import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import type { Task } from '../types/model'

export async function addTask(name: string, patch: Partial<Task> = {}): Promise<string> {
  const now = nowISO()
  const all = await db.tasks.where('projectId').equals(PROJECT_ID).toArray()
  const sortNo = all.length ? Math.max(...all.map((t) => t.sortNo)) + 1 : 0
  const id = newId()
  await db.tasks.put({
    id, projectId: PROJECT_ID, name,
    percent: 0, status: 'not_started', sortNo,
    createdAt: now, updatedAt: now,
    ...patch,
  })
  return id
}

// percent を更新すると status を自動整合（0=未着手 / 1..99=進行 / 100=完了）
export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const p = { ...patch }
  if (p.percent !== undefined) {
    p.percent = Math.max(0, Math.min(100, Math.round(p.percent)))
    p.status = p.percent >= 100 ? 'done' : p.percent > 0 ? 'in_progress' : 'not_started'
  }
  await db.tasks.update(id, { ...p, updatedAt: nowISO() })
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id)
}

// 見積の大項目(工種)から未作成分のタスクを一括生成
export async function createTasksFromMajors(
  majors: { id: string; name: string }[],
): Promise<number> {
  const existing = await db.tasks.where('projectId').equals(PROJECT_ID).toArray()
  let added = 0
  for (const m of majors) {
    if (existing.some((t) => t.linkedMajorId === m.id)) continue
    await addTask(m.name, { linkedMajorId: m.id })
    added++
  }
  return added
}
