import type { Vec, ID } from '../types/model'

// 編集中の部屋（geometry の room shape に対応。頂点列が真実）
export interface EditableRoom {
  id: ID
  name: string
  vertices: Vec[]
}

export type Tool = 'draw' | 'select' | 'pan'

export interface VertexRef {
  roomId: ID
  vertexIndex: number
}

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}
