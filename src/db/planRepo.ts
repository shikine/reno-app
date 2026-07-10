import { db, newId, nowISO } from './db'
import type { Plan, PlanGeometry, Project, QuantityType, Room, Shape, Takeoff, Vec, Wall } from '../types/model'
import type { EditableRoom } from '../drawing/editorTypes'
import { bbox, dist, perimeterMm, polygonAreaM2 } from '../drawing/geometry'

// MVP: デモ案件・既存プランを固定IDで1件持つ（StrictModeの二重実行でも重複しない）。
export const PROJECT_ID = 'demo-project'
export const PLAN_ID = 'demo-plan-existing'
const DEFAULT_CEILING_MM = 2400

export interface PlanMeta {
  gridPitchMm: number
  wallThicknessMm: number
}

export async function ensurePlan(): Promise<Plan> {
  const existing = await db.plans.get(PLAN_ID)
  if (existing) return existing

  const now = nowISO()
  const project: Project = {
    id: PROJECT_ID, createdAt: now, updatedAt: now,
    name: '（サンプル案件）', customerName: '', buildingType: 'detached', status: 'survey',
  }
  const plan: Plan = {
    id: PLAN_ID, projectId: PROJECT_ID, createdAt: now, updatedAt: now,
    kind: 'existing', revisionNo: 1, title: '既存プラン', isCurrent: true,
    geometry: { scale: 50, gridPitchMm: 910, wallThicknessMm: 120, layers: ['existing'], shapes: [] },
  }
  await db.projects.put(project)
  await db.plans.put(plan)
  return plan
}

export function roomsFromGeometry(geo: PlanGeometry): EditableRoom[] {
  return geo.shapes
    .filter((s): s is Extract<Shape, { type: 'room' }> => s.type === 'room')
    .map((s) => ({ id: s.elementId, name: s.name, vertices: s.points }))
}

// EditableRoom[] を データモデル（geometry(JSON) ＋ Room/Wall 行）へ写して保存。
export async function savePlan(rooms: EditableRoom[], meta: PlanMeta): Promise<void> {
  const plan = await ensurePlan()
  const now = nowISO()

  const shapes: Shape[] = []
  const roomRows: Room[] = []
  const wallRows: Wall[] = []

  for (const room of rooms) {
    shapes.push({ type: 'room', elementId: room.id, name: room.name, points: room.vertices })

    const box = bbox(room.vertices)
    roomRows.push({
      id: room.id, planId: plan.id, createdAt: now, updatedAt: now,
      name: room.name, widthMm: Math.round(box.width), depthMm: Math.round(box.height),
      ceilingHeightMm: DEFAULT_CEILING_MM,
      floorAreaM2: polygonAreaM2(room.vertices),
      ceilingAreaM2: polygonAreaM2(room.vertices),
      workType: 'new',
    })

    const n = room.vertices.length
    for (let i = 0; i < n; i++) {
      const a = room.vertices[i]
      const b = room.vertices[(i + 1) % n]
      const lengthMm = Math.round(dist(a, b))
      const areaM2 = (lengthMm * DEFAULT_CEILING_MM) / 1_000_000
      const wallId = newId()
      wallRows.push({
        id: wallId, planId: plan.id, roomId: room.id, createdAt: now, updatedAt: now,
        lengthMm, heightMm: DEFAULT_CEILING_MM, grossAreaM2: areaM2, netAreaM2: areaM2, workType: 'new',
      })
      shapes.push({ type: 'wall', elementId: wallId, roomId: room.id, line: [a as Vec, b as Vec] })
    }
  }

  const geometry: PlanGeometry = {
    scale: plan.geometry.scale,
    gridPitchMm: meta.gridPitchMm,
    wallThicknessMm: meta.wallThicknessMm,
    layers: plan.geometry.layers,
    shapes,
  }

  await db.transaction('rw', db.plans, db.rooms, db.walls, db.takeoffs, async () => {
    await db.plans.update(plan.id, { geometry, updatedAt: now })
    await db.rooms.where('planId').equals(plan.id).delete()
    await db.walls.where('planId').equals(plan.id).delete()
    await db.rooms.bulkPut(roomRows)
    await db.walls.bulkPut(wallRows)
    await upsertRoomTakeoffs(rooms, now)
  })
}

// 部屋由来の Takeoff（床/天井/壁面積）を再計算して upsert。
// ID は (sourceId, quantityType) で安定させ、見積明細からの参照を切らない。
async function upsertRoomTakeoffs(rooms: EditableRoom[], now: string): Promise<void> {
  const existing = await db.takeoffs.where('projectId').equals(PROJECT_ID).toArray()
  const roomTk = existing.filter((t) => t.sourceType === 'room')
  const keep = new Set<string>()
  const puts: Takeoff[] = []

  for (const room of rooms) {
    const floor = polygonAreaM2(room.vertices)
    const perimM = perimeterMm(room.vertices) / 1000
    const wall = (perimeterMm(room.vertices) * DEFAULT_CEILING_MM) / 1_000_000
    const defs: { qt: QuantityType; unit: string; value: number; note: string }[] = [
      { qt: 'floor_area', unit: 'm2', value: floor, note: `${room.name} 床` },
      { qt: 'ceiling_area', unit: 'm2', value: floor, note: `${room.name} 天井` },
      { qt: 'wall_area', unit: 'm2', value: wall, note: `${room.name} 壁 外周${perimM.toFixed(1)}m×天高${(DEFAULT_CEILING_MM / 1000).toFixed(1)}m` },
    ]
    for (const d of defs) {
      const ex = roomTk.find((t) => t.sourceId === room.id && t.quantityType === d.qt)
      if (ex) {
        keep.add(ex.id)
        puts.push({ ...ex, value: d.value, calcNote: d.note, updatedAt: now })
      } else {
        const id = newId()
        keep.add(id)
        puts.push({
          id, projectId: PROJECT_ID, sourceType: 'room', sourceId: room.id,
          quantityType: d.qt, unit: d.unit, value: d.value, calcNote: d.note,
          createdAt: now, updatedAt: now,
        })
      }
    }
  }

  const gone = roomTk.filter((t) => !keep.has(t.id)).map((t) => t.id)
  await db.takeoffs.bulkPut(puts)
  await db.takeoffs.bulkDelete(gone)
}

export async function exportPlanJSON(): Promise<string> {
  const plan = await db.plans.get(PLAN_ID)
  const rooms = await db.rooms.where('planId').equals(PLAN_ID).toArray()
  const walls = await db.walls.where('planId').equals(PLAN_ID).toArray()
  return JSON.stringify({ plan, rooms, walls }, null, 2)
}
