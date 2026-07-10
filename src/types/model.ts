// Phase 0 データモデル（04_データモデル_TypeScript版）の作図フェーズで使う部分。
// 型がスキーマ、Dexie ストアがテーブル。参照整合はアプリ層で担保する。

export type ID = string
export type ISODateTime = string
export type MM = number
export type M2 = number

export interface Base {
  id: ID
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// ---- Project ----
export type BuildingType = 'detached' | 'apartment' | 'other'
export type ProjectStatus =
  | 'lead' | 'survey' | 'proposal' | 'contracted' | 'in_progress' | 'done' | 'lost'

export interface Project extends Base {
  code?: string
  name: string
  customerName: string
  buildingType: BuildingType
  status: ProjectStatus
  contractAmount?: number
  note?: string
}

// ---- Plan（図面：既存/完成の版） ----
export type PlanKind = 'existing' | 'completed'

export interface Plan extends Base {
  projectId: ID
  kind: PlanKind
  revisionNo: number
  title: string
  geometry: PlanGeometry
  isCurrent: boolean
}

// ---- 作図要素（意味単位・安定ID） ----
export type WorkType = 'keep' | 'demolish' | 'new' | 'finish_change'

export interface Room extends Base {
  planId: ID
  name: string
  widthMm: MM
  depthMm: MM
  ceilingHeightMm: MM
  floorAreaM2: M2
  ceilingAreaM2: M2
  workType: WorkType
  note?: string
}

export interface Wall extends Base {
  planId: ID
  roomId?: ID
  lengthMm: MM
  heightMm: MM
  grossAreaM2: M2
  netAreaM2: M2
  workType: WorkType
}

export type OpeningKind = 'door' | 'window' | 'opening'
export interface Opening extends Base {
  planId: ID
  wallId: ID
  kind: OpeningKind
  widthMm: MM
  heightMm: MM
  areaM2: M2
  workType: 'keep' | 'demolish' | 'new'
}

// ---- 図面データ（ハイブリッド：描画は geometry(JSON)、意味要素は行としても実体化） ----
export type Vec = [number, number] // mm

export type Shape =
  | { type: 'room'; elementId: ID; name: string; points: Vec[] }
  | { type: 'wall'; elementId: ID; roomId?: ID; line: [Vec, Vec] }
  | { type: 'opening'; elementId: ID; wallId: ID; pos: number; width: number; kind: OpeningKind }

export interface PlanGeometry {
  scale: number        // 例 50 → 1:50
  gridPitchMm: number  // 芯々グリッドの基準ピッチ
  wallThicknessMm: number
  layers: PlanKind[]
  shapes: Shape[]
}

// ---- 数量拾い（A→B の橋渡し。作図から再計算される「現在値」を持つ） ----
export type TakeoffSource = 'room' | 'wall' | 'opening' | 'manual'
export type QuantityType = 'floor_area' | 'wall_area' | 'ceiling_area' | 'perimeter' | 'count'

export interface Takeoff extends Base {
  projectId: ID
  sourceType: TakeoffSource
  sourceId?: ID          // Room/Wall/Opening の安定ID（manual時 undefined）
  quantityType: QuantityType
  unit: string           // 'm2' | 'm' | '箇所' | '式'
  value: number          // 現在値（作図保存のたびに再計算）
  calcNote?: string      // 算出根拠
}

// ---- 工程タスク（MVP: 工種帯＝見積の大項目に紐づけ） ----
export type TaskStatus = 'not_started' | 'in_progress' | 'done'

export interface Task extends Base {
  projectId: ID
  name: string
  linkedMajorId?: ID     // 見積の大項目(工種) EstimateItem.id
  vendorName?: string    // 職人/業者（個人ツールなので文字列で簡易に）
  plannedStart?: string  // ISODate
  plannedEnd?: string
  percent: number        // 0..100
  status: TaskStatus
  note?: string
  sortNo: number
}

// ---- 実績原価（実費。明細に割付、null=現場共通費） ----
export type CostKind = 'material' | 'labor' | 'subcontract' | 'expense'

export interface Cost extends Base {
  projectId: ID
  estimateItemId?: ID    // 割付先の見積明細（undefined=現場共通費）
  vendorName?: string    // 支払先（簡易に文字列）
  kind: CostKind
  title: string
  amount: number         // 円
  incurredAt: string     // ISODate 発生日
  note?: string
}

// ---- 見積（版：提案/契約/追加変更） ----
export type EstimateType = 'quote' | 'contract' | 'change_order'
export type EstimateStatus = 'draft' | 'proposed' | 'locked' | 'superseded'

export interface Estimate extends Base {
  projectId: ID
  parentEstimateId?: ID
  type: EstimateType
  label: string
  revisionNo: number
  status: EstimateStatus
  isCurrent: boolean
  lockedAt?: ISODateTime  // 凍結日時（locked にした時刻）
  taxRate: number     // 0.10 など
  discount: number    // 値引（円）
}

// 大項目/中項目/明細 を1テーブルの木で持つ（parentId + type）。
// item のみ数量・単価・原価を持ち、major/section は集計見出し。
export type EstimateItemType = 'major' | 'section' | 'item'

export interface EstimateItem extends Base {
  estimateId: ID
  parentId: ID | null
  type: EstimateItemType
  sortNo: number
  name: string
  spec?: string
  // item のみ:
  unit?: string
  quantity?: number
  costUnitPrice?: number  // 予定原価単価（円）
  marginRate?: number     // 粗利率 0..1
  unitPrice?: number      // 売単価（円）
  // 連携（次段階）: 作図の拾い由来
  sourceTakeoffId?: ID
}
