import { type PointerEvent as RPE, type ReactNode, type WheelEvent as RWE, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Vec } from '../types/model'
import type { EditableRoom, Tool, VertexRef, ViewBox } from './editorTypes'
import { dist, mid, polygonAreaM2, roundMm, snapPoint } from './geometry'

interface Props {
  rooms: EditableRoom[]
  draft: Vec[]
  tool: Tool
  gridPitch: number
  snapEnabled: boolean
  showGrid: boolean
  wallThicknessMm: number
  selected: VertexRef | null
  onDrawTap: (mm: Vec) => void
  onCloseDraft: () => void
  onSelectVertex: (sel: VertexRef | null) => void
  onMoveVertex: (roomId: string, vertexIndex: number, mm: Vec) => void
  fitToken: number
}

type Gesture =
  | { type: 'tap'; startClient: Vec; moved: boolean }
  | { type: 'pan'; lastClient: Vec }
  | { type: 'vertex'; ref: VertexRef }
  | { type: 'pinch'; startDist: number; startMid: Vec; startVb: ViewBox }
  | null

const DEFAULT_VB: ViewBox = { x: -1000, y: -1000, w: 14000, h: 10000 }

export default function PlanCanvas(props: Props) {
  const {
    rooms, draft, tool, gridPitch, snapEnabled, showGrid, wallThicknessMm,
    selected, onDrawTap, onCloseDraft, onSelectVertex, onMoveVertex, fitToken,
  } = props

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [vb, setVbState] = useState<ViewBox>(DEFAULT_VB)
  const vbRef = useRef<ViewBox>(DEFAULT_VB)
  const [hover, setHover] = useState<Vec | null>(null)

  const pointers = useRef<Map<number, Vec>>(new Map())
  const gesture = useRef<Gesture>(null)

  const setVb = useCallback((next: ViewBox) => {
    vbRef.current = next
    setVbState(next)
  }, [])

  const rect = () => svgRef.current?.getBoundingClientRect()

  const clientToMm = useCallback((cx: number, cy: number, box?: ViewBox): Vec => {
    const r = rect()
    const b = box ?? vbRef.current
    if (!r) return [0, 0]
    return [b.x + ((cx - r.left) / r.width) * b.w, b.y + ((cy - r.top) / r.height) * b.h]
  }, [])

  // viewBox のアスペクトを描画領域に合わせる（正方グリッド維持・preserveAspectRatio=none）
  const syncAspect = useCallback(() => {
    const r = rect()
    if (!r || r.width === 0) return
    const b = vbRef.current
    const targetH = b.w * (r.height / r.width)
    if (Math.abs(targetH - b.h) > 0.5) setVb({ ...b, h: targetH })
  }, [setVb])

  useLayoutEffect(() => {
    syncAspect()
    const ro = new ResizeObserver(() => syncAspect())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [syncAspect])

  // 全体を収める（fit）
  useEffect(() => {
    const all: Vec[] = [...draft, ...rooms.flatMap((r) => r.vertices)]
    const r = rect()
    if (all.length < 2 || !r) return
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const padX = Math.max((maxX - minX) * 0.15, 1500)
    const padY = Math.max((maxY - minY) * 0.15, 1500)
    let w = maxX - minX + padX * 2
    let h = maxY - minY + padY * 2
    const aspect = r.height / r.width
    if (h / w < aspect) h = w * aspect
    else w = h / aspect
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken])

  const snappedFromClient = useCallback(
    (cx: number, cy: number): Vec => snapPoint(clientToMm(cx, cy), gridPitch, snapEnabled),
    [clientToMm, gridPitch, snapEnabled],
  )

  const handleR = vb.w * 0.011
  const closeDistMm = snapEnabled ? Math.max(gridPitch * 0.5, 150) : vb.w * 0.03

  const hitVertex = useCallback((mm: Vec): VertexRef | null => {
    const thr = vb.w * 0.02
    for (const room of rooms) {
      for (let i = 0; i < room.vertices.length; i++) {
        if (dist(room.vertices[i], mm) <= thr) return { roomId: room.id, vertexIndex: i }
      }
    }
    return null
  }, [rooms, vb.w])

  const midClient = (): Vec => {
    const pts = [...pointers.current.values()]
    return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
  }
  const distClient = (): number => {
    const pts = [...pointers.current.values()]
    return Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
  }

  const onPointerDown = (e: RPE<SVGSVGElement>) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, [e.clientX, e.clientY])

    if (pointers.current.size === 2) {
      gesture.current = { type: 'pinch', startDist: distClient(), startMid: midClient(), startVb: vbRef.current }
      return
    }
    if (pointers.current.size !== 1) return

    const mm = clientToMm(e.clientX, e.clientY)
    if (tool === 'select') {
      const hit = hitVertex(mm)
      if (hit) { onSelectVertex(hit); gesture.current = { type: 'vertex', ref: hit }; return }
      onSelectVertex(null)
      gesture.current = { type: 'pan', lastClient: [e.clientX, e.clientY] }
    } else if (tool === 'pan') {
      gesture.current = { type: 'pan', lastClient: [e.clientX, e.clientY] }
    } else {
      gesture.current = { type: 'tap', startClient: [e.clientX, e.clientY], moved: false }
      setHover(snappedFromClient(e.clientX, e.clientY))
    }
  }

  const onPointerMove = (e: RPE<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    const g = gesture.current

    if (g?.type === 'pinch' && pointers.current.size >= 2) {
      const curDist = distClient() || 1
      const curMid = midClient()
      const factor = g.startDist / curDist
      const newW = g.startVb.w * factor
      const newH = g.startVb.h * factor
      const anchor = clientToMm(g.startMid[0], g.startMid[1], g.startVb)
      const r = rect()!
      setVb({
        x: anchor[0] - ((curMid[0] - r.left) / r.width) * newW,
        y: anchor[1] - ((curMid[1] - r.top) / r.height) * newH,
        w: newW, h: newH,
      })
      return
    }

    if (g?.type === 'pan') {
      const r = rect()!
      const b = vbRef.current
      const dx = (e.clientX - g.lastClient[0]) / r.width * b.w
      const dy = (e.clientY - g.lastClient[1]) / r.height * b.h
      setVb({ ...b, x: b.x - dx, y: b.y - dy })
      g.lastClient = [e.clientX, e.clientY]
      return
    }

    if (g?.type === 'vertex') {
      onMoveVertex(g.ref.roomId, g.ref.vertexIndex, snappedFromClient(e.clientX, e.clientY))
      return
    }

    if (g?.type === 'tap') {
      if (dist(g.startClient, [e.clientX, e.clientY]) > 8) g.moved = true
    }
    if (tool === 'draw') setHover(snappedFromClient(e.clientX, e.clientY))
  }

  const endPointer = (e: RPE<SVGSVGElement>) => {
    const g = gesture.current
    if (g?.type === 'tap' && !g.moved) {
      const mm = snappedFromClient(e.clientX, e.clientY)
      if (draft.length >= 3 && dist(mm, draft[0]) <= closeDistMm) onCloseDraft()
      else onDrawTap(mm)
    }
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    else if (g?.type === 'pinch' && pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0]
      gesture.current = { type: 'pan', lastClient: remaining }
    }
  }

  const onWheel = (e: RWE<SVGSVGElement>) => {
    const r = rect()
    if (!r) return
    const b = vbRef.current
    const factor = e.deltaY > 0 ? 1.12 : 0.89
    const anchor = clientToMm(e.clientX, e.clientY)
    const newW = b.w * factor, newH = b.h * factor
    setVb({
      x: anchor[0] - ((e.clientX - r.left) / r.width) * newW,
      y: anchor[1] - ((e.clientY - r.top) / r.height) * newH,
      w: newW, h: newH,
    })
  }

  const zoomBy = (factor: number) => {
    const b = vbRef.current
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const newW = b.w * factor, newH = b.h * factor
    setVb({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH })
  }

  // ---- 描画サイズ（viewBox 幅基準で見た目一定に） ----
  const U = vb.w
  const gridStroke = U * 0.0006
  const outlineStroke = U * 0.0016
  const wallStroke = Math.max(wallThicknessMm, U * 0.004)
  const font = U * 0.02
  const dimFont = U * 0.017

  const gridLines = () => {
    if (!showGrid) return null
    const nx = vb.w / gridPitch, ny = vb.h / gridPitch
    if (nx > 400 || ny > 400) return null
    const lines: ReactNode[] = []
    const x0 = Math.ceil(vb.x / gridPitch) * gridPitch
    for (let x = x0; x <= vb.x + vb.w; x += gridPitch) {
      const major = Math.round(x / gridPitch) % 2 === 0
      lines.push(<line key={`v${x}`} x1={x} y1={vb.y} x2={x} y2={vb.y + vb.h}
        stroke="#c9d3dd" strokeWidth={gridStroke * (major ? 1.6 : 1)} />)
    }
    const y0 = Math.ceil(vb.y / gridPitch) * gridPitch
    for (let y = y0; y <= vb.y + vb.h; y += gridPitch) {
      const major = Math.round(y / gridPitch) % 2 === 0
      lines.push(<line key={`h${y}`} x1={vb.x} y1={y} x2={vb.x + vb.w} y2={y}
        stroke="#c9d3dd" strokeWidth={gridStroke * (major ? 1.6 : 1)} />)
    }
    return <g>{lines}</g>
  }

  const edgeLabel = (a: Vec, b: Vec, key: string) => {
    const m = mid(a, b)
    const len = roundMm(dist(a, b))
    if (len === 0) return null
    return (
      <text key={key} x={m[0]} y={m[1]} fontSize={dimFont} fill="#334155"
        textAnchor="middle" dominantBaseline="central"
        style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: dimFont * 0.28 }}>
        {len}
      </text>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="none"
        width="100%" height="100%"
        style={{ touchAction: 'none', background: '#f7fafc', display: 'block',
          cursor: tool === 'pan' ? 'grab' : tool === 'draw' ? 'crosshair' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      >
        {gridLines()}

        {/* 確定済みの部屋 */}
        {rooms.map((room) => {
          const pts = room.vertices
          const ptsStr = pts.map((p) => p.join(',')).join(' ')
          const c = centroid(pts)
          const area = polygonAreaM2(pts)
          return (
            <g key={room.id}>
              <polygon points={ptsStr} fill="rgba(120,160,210,0.14)"
                stroke="#5b7fb0" strokeWidth={wallStroke} strokeLinejoin="round" />
              <polygon points={ptsStr} fill="none" stroke="#2f496b" strokeWidth={outlineStroke} strokeLinejoin="round" />
              {pts.map((p, i) => edgeLabel(p, pts[(i + 1) % pts.length], `${room.id}-e${i}`))}
              <text x={c[0]} y={c[1] - font * 0.6} fontSize={font} fill="#1f2d3d"
                textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: font * 0.25 }}>
                {room.name}
              </text>
              <text x={c[0]} y={c[1] + font * 0.7} fontSize={font * 0.95} fill="#2563eb"
                textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: font * 0.25 }}>
                {area.toFixed(2)} ㎡
              </text>
              {tool === 'select' && pts.map((p, i) => (
                <circle key={`${room.id}-v${i}`} cx={p[0]} cy={p[1]} r={handleR}
                  fill={selected && selected.roomId === room.id && selected.vertexIndex === i ? '#2563eb' : '#fff'}
                  stroke="#2563eb" strokeWidth={outlineStroke} />
              ))}
            </g>
          )
        })}

        {/* 作図中のドラフト */}
        {draft.length > 0 && (
          <g>
            <polyline points={draft.map((p) => p.join(',')).join(' ')}
              fill="none" stroke="#e0692f" strokeWidth={wallStroke} strokeLinejoin="round" strokeLinecap="round"
              opacity={0.9} />
            {draft.map((p, i) => i < draft.length - 1 && edgeLabel(p, draft[i + 1], `d-e${i}`))}
            {hover && tool === 'draw' && (
              <>
                <line x1={draft[draft.length - 1][0]} y1={draft[draft.length - 1][1]}
                  x2={hover[0]} y2={hover[1]} stroke="#e0692f" strokeWidth={outlineStroke} strokeDasharray={`${U * 0.006},${U * 0.006}`} />
                {edgeLabel(draft[draft.length - 1], hover, 'd-preview')}
              </>
            )}
            {draft.map((p, i) => (
              <circle key={`d-v${i}`} cx={p[0]} cy={p[1]} r={handleR * (i === 0 ? 1.3 : 1)}
                fill={i === 0 ? '#e0692f' : '#fff'} stroke="#e0692f" strokeWidth={outlineStroke} />
            ))}
          </g>
        )}

        {/* カーソル十字（作図ツール） */}
        {hover && tool === 'draw' && (
          <g stroke="#e0692f" strokeWidth={outlineStroke} opacity={0.8}>
            <line x1={hover[0] - handleR * 1.6} y1={hover[1]} x2={hover[0] + handleR * 1.6} y2={hover[1]} />
            <line x1={hover[0]} y1={hover[1] - handleR * 1.6} x2={hover[0]} y2={hover[1] + handleR * 1.6} />
          </g>
        )}
      </svg>

      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="zoom-btn" onClick={() => zoomBy(0.8)} aria-label="拡大">＋</button>
        <button className="zoom-btn" onClick={() => zoomBy(1.25)} aria-label="縮小">－</button>
      </div>
    </div>
  )
}

function centroid(pts: Vec[]): Vec {
  if (pts.length === 0) return [0, 0]
  const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0] as Vec)
  return [s[0] / pts.length, s[1] / pts.length]
}
