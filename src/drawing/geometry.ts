import type { Vec } from '../types/model'

export const snap1D = (v: number, pitch: number) => Math.round(v / pitch) * pitch

export function snapPoint(p: Vec, pitch: number, enabled: boolean): Vec {
  if (!enabled || pitch <= 0) return [p[0], p[1]]
  return [snap1D(p[0], pitch), snap1D(p[1], pitch)]
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1])

export const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

// 多角形面積（mm 座標）→ ㎡。符号なし。
export function polygonAreaM2(pts: Vec[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2 / 1_000_000
}

// 外周長（mm）
export function perimeterMm(pts: Vec[]): number {
  if (pts.length < 2) return 0
  let s = 0
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length])
  return s
}

// 軸そろえ境界ボックス（mm）
export function bbox(pts: Vec[]) {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

// anchor から dir 方向に length の位置へ動かした点（辺の長さ手入力に使う）
export function pointAtLength(anchor: Vec, toward: Vec, length: number): Vec {
  const d = dist(anchor, toward) || 1
  const ux = (toward[0] - anchor[0]) / d
  const uy = (toward[1] - anchor[1]) / d
  return [anchor[0] + ux * length, anchor[1] + uy * length]
}

export const roundMm = (v: number) => Math.round(v)
