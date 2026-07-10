import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  addNode, deleteNode, DEFAULT_MARGIN, editItemField, ensureEstimate, ESTIMATE_ID, updateEstimate,
} from '../db/estimateRepo'
import { computeTotals, itemCost, itemSell, pct, subtreeSum, yen } from '../estimate/estimateTotals'
import type { EstimateItem } from '../types/model'
import { NumberField, TextField } from '../ui/fields'

export default function EstimateTab() {
  const [newMargin, setNewMargin] = useState(DEFAULT_MARGIN)

  useEffect(() => { ensureEstimate() }, [])

  const estimate = useLiveQuery(() => db.estimates.get(ESTIMATE_ID), [])
  const items = useLiveQuery(
    () => db.estimateItems.where('estimateId').equals(ESTIMATE_ID).toArray(),
    [],
  ) ?? []
  const takeoffs = useLiveQuery(() => db.takeoffs.toArray(), []) ?? []
  const tkById = new Map(takeoffs.map((t) => [t.id, t]))

  const taxRate = estimate?.taxRate ?? 0.1
  const discount = estimate?.discount ?? 0
  const totals = computeTotals(items, taxRate, discount)

  const sortItems = (a: EstimateItem, b: EstimateItem) => a.sortNo - b.sortNo
  const majors = items.filter((i) => i.type === 'major').sort(sortItems)
  const sectionsOf = (pid: string) => items.filter((i) => i.type === 'section' && i.parentId === pid).sort(sortItems)
  const itemsOf = (pid: string) => items.filter((i) => i.type === 'item' && i.parentId === pid).sort(sortItems)

  const num = (v: number | undefined) => (v ?? 0)

  return (
    <div className="est">
      <div className="est-toolbar no-print">
        <div className="est-title">
          <b>{estimate?.label ?? '見積'}</b>
          <span className="badge">{statusLabel(estimate?.status)}</span>
          <span className="muted">（版管理・作図連携・実績原価は次段階）</span>
        </div>
        <div className="est-controls">
          <label>既定粗利率
            <input type="number" value={Math.round(newMargin * 1000) / 10} step={1}
              onChange={(e) => setNewMargin(Number(e.target.value) / 100)} />%
          </label>
          <label>消費税
            <NumberField value={Math.round(taxRate * 100)} step={1}
              onCommit={(v) => updateEstimate({ taxRate: v / 100 })} />%
          </label>
          <label>値引
            <NumberField value={discount} step={1000}
              onCommit={(v) => updateEstimate({ discount: v })} />円
          </label>
          <button onClick={() => window.print()}>🖶 印刷 / PDF</button>
          <button className="primary" onClick={() => addNode('major', null, '大項目')}>＋ 大項目</button>
        </div>
      </div>

      <div className="est-body">
        {majors.length === 0 && (
          <p className="muted empty">「＋ 大項目」から工種（例：内装工事）を追加し、中項目 → 明細と入力してください。</p>
        )}

        {majors.map((major) => {
          const ms = subtreeSum(items, major.id)
          return (
            <div className="major" key={major.id}>
              <div className="major-head">
                <TextField className="name" value={major.name}
                  onCommit={(v) => db.estimateItems.update(major.id, { name: v })} />
                <span className="sub">売 {yen(ms.sell)} / 原価 {yen(ms.cost)} / 粗利 {yen(ms.sell - ms.cost)}</span>
                <button onClick={() => addNode('section', major.id, '中項目')}>＋中項目</button>
                <button className="del" onClick={() => deleteNode(major.id)}>🗑</button>
              </div>

              {sectionsOf(major.id).map((section) => {
                const ss = subtreeSum(items, section.id)
                return (
                  <div className="section" key={section.id}>
                    <div className="section-head">
                      <TextField className="name" value={section.name}
                        onCommit={(v) => db.estimateItems.update(section.id, { name: v })} />
                      <span className="sub">売 {yen(ss.sell)} / 原価 {yen(ss.cost)}</span>
                      <button onClick={() => addNode('item', section.id, '項目', newMargin)}>＋明細</button>
                      <button className="del" onClick={() => deleteNode(section.id)}>🗑</button>
                    </div>

                    <div className="item-head">
                      <span>名称</span><span>数量</span><span>単位</span>
                      <span>原価単価</span><span>粗利率</span><span>売単価</span>
                      <span>金額</span><span>粗利</span><span></span>
                    </div>

                    {itemsOf(section.id).map((it) => (
                      <div className="item-row" key={it.id}>
                        <TextField value={it.name} onCommit={(v) => editItemField(it, 'name', v)} />
                        <div className="qty-cell">
                          <NumberField value={num(it.quantity)} step={1}
                            onCommit={(v) => editItemField(it, 'quantity', v)} />
                          {(() => {
                            if (!it.sourceTakeoffId) return null
                            const tk = tkById.get(it.sourceTakeoffId)
                            if (!tk) return <span className="diff gone" title="図面から該当部位が削除されています">⚠ 図面に無し</span>
                            const cur = Math.round(tk.value * 100) / 100
                            if (Math.abs(cur - num(it.quantity)) < 0.005) return null
                            return (
                              <button className="diff" title={tk.calcNote ?? ''}
                                onClick={() => editItemField(it, 'quantity', cur)}>
                                ⚠ 図面 {cur.toFixed(2)} ← タップで更新
                              </button>
                            )
                          })()}
                        </div>
                        <TextField value={it.unit ?? ''} onCommit={(v) => editItemField(it, 'unit', v)} />
                        <NumberField value={num(it.costUnitPrice)} step={100}
                          onCommit={(v) => editItemField(it, 'costUnitPrice', v)} />
                        <NumberField value={Math.round(num(it.marginRate) * 1000) / 10} step={1}
                          onCommit={(v) => editItemField(it, 'marginRate', v / 100)} />
                        <NumberField value={num(it.unitPrice)} step={100}
                          onCommit={(v) => editItemField(it, 'unitPrice', v)} />
                        <span className="amount">{yen(itemSell(it))}</span>
                        <span className="profit">{yen(itemSell(it) - itemCost(it))}</span>
                        <button className="del" onClick={() => deleteNode(it.id)}>🗑</button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="est-totals">
        <div className="row"><span>見積（売価）</span><b>{yen(totals.sell)}</b></div>
        <div className="row"><span>予定原価</span><b>{yen(totals.cost)}</b></div>
        <div className="row profit"><span>粗利（{pct(totals.marginRate)}）</span><b>{yen(totals.profit)}</b></div>
        {discount > 0 && <div className="row"><span>値引</span><b>-{yen(discount)}</b></div>}
        <div className="row"><span>消費税（{pct(taxRate)}）</span><b>{yen(totals.tax)}</b></div>
        <div className="row total"><span>税込合計</span><b>{yen(totals.total)}</b></div>
      </div>
    </div>
  )
}

function statusLabel(s?: string) {
  return s === 'locked' ? '契約(凍結)' : s === 'proposed' ? '提示' : s === 'superseded' ? '失効' : '下書き'
}
