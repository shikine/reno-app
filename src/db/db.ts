import Dexie, { type Table } from 'dexie'
import type { Project, Plan, Room, Wall, Opening, Estimate, EstimateItem, Takeoff, Task, Cost, Payment, Attachment } from '../types/model'

// Dexie は FK 制約を持たないため、索引は逆引きする列に付け、整合はアプリ層で担保する。
export class RenoDB extends Dexie {
  projects!: Table<Project, string>
  plans!: Table<Plan, string>
  rooms!: Table<Room, string>
  walls!: Table<Wall, string>
  openings!: Table<Opening, string>
  estimates!: Table<Estimate, string>
  estimateItems!: Table<EstimateItem, string>
  takeoffs!: Table<Takeoff, string>
  tasks!: Table<Task, string>
  settings!: Table<{ key: string; value: unknown }, string>
  costs!: Table<Cost, string>
  payments!: Table<Payment, string>
  attachments!: Table<Attachment, string>

  constructor() {
    super('renovation-app')
    this.version(1).stores({
      projects: '&id, status',
      plans: '&id, projectId, kind, isCurrent',
      rooms: '&id, planId, workType',
      walls: '&id, planId, roomId, workType',
      openings: '&id, planId, wallId',
    })
    this.version(2).stores({
      estimates: '&id, projectId, type, status, isCurrent',
      estimateItems: '&id, estimateId, parentId, type',
    })
    this.version(3).stores({
      takeoffs: '&id, projectId, [sourceType+sourceId]',
    })
    this.version(4).stores({
      tasks: '&id, projectId, linkedMajorId, sortNo',
    })
    this.version(5).stores({
      settings: '&key',
    })
    this.version(6).stores({
      costs: '&id, projectId, estimateItemId, incurredAt',
    })
    this.version(7).stores({
      payments: '&id, projectId, direction, plannedDate',
    })
    // 写真はBlobで保存（JSONバックアップ対象外。容量が大きいため）
    this.version(8).stores({
      attachments: '&id, projectId, [targetType+targetId]',
    })
  }
}

export const db = new RenoDB()

export const nowISO = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()
