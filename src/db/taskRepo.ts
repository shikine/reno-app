import { db, newId, nowISO } from './db'
import { PROJECT_ID } from './planRepo'
import type { Task } from '../types/model'

export async function addTask(name: string, patch: Partial<Task> = {}): Promise<string> {
  const now = nowISO()
  const all = await db.tasks.where('projectId').equals(PROJECT_ID).toArray()
  const sibs = all.filter((t) => (t.parentTaskId ?? null) === (patch.parentTaskId ?? null))
  const sortNo = sibs.length ? Math.max(...sibs.map((t) => t.sortNo)) + 1 : 0
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

// 子孫ごと削除（親を消したら配下も消える）
export async function deleteTask(id: string): Promise<void> {
  const all = await db.tasks.toArray()
  const toDel: string[] = []
  const walk = (tid: string) => {
    toDel.push(tid)
    for (const c of all.filter((t) => t.parentTaskId === tid)) walk(c.id)
  }
  walk(id)
  await db.tasks.bulkDelete(toDel)
}

// 同じ親の中で dragId を targetId の前/後に並べ替える
export async function moveTask(dragId: string, targetId: string, after: boolean): Promise<void> {
  if (dragId === targetId) return
  const all = await db.tasks.toArray()
  const drag = all.find((t) => t.id === dragId)
  const target = all.find((t) => t.id === targetId)
  if (!drag || !target) return
  if ((drag.parentTaskId ?? null) !== (target.parentTaskId ?? null)) return

  const sibs = all
    .filter((t) => (t.parentTaskId ?? null) === (drag.parentTaskId ?? null) && t.id !== dragId)
    .sort((a, b) => a.sortNo - b.sortNo)
  let idx = sibs.findIndex((t) => t.id === targetId)
  if (idx < 0) return
  if (after) idx += 1
  sibs.splice(idx, 0, drag)

  const now = nowISO()
  await db.transaction('rw', db.tasks, async () => {
    for (let i = 0; i < sibs.length; i++) {
      if (sibs[i].sortNo !== i) await db.tasks.update(sibs[i].id, { sortNo: i, updatedAt: now })
    }
  })
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
