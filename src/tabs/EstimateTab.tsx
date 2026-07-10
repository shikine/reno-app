import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import {
  addNode, confirmContract, createChangeOrder, DEFAULT_MARGIN, deleteNode,
  editItemField, ensureEstimate, lockEstimate, pickEditable, pickScope,
  updateEstimate, updateNode,
} from '../db/estimateRepo'
import { addCost, deleteCost, updateCost } from '../db/costRepo'
import { computeTotals, itemCost, itemSell, pct, subtreeSum, yen } from '../estimate/estimateTotals'
import type { Cost, CostKind, Estimate, EstimateItem } from '../types/model'
import { NumberField, TextField } from '../ui/fields'

const COST_KINDS: [CostKind, string][] = [
  ['material', '材料'], ['labor', '手間'], ['subcontract', '外注'], ['expense', '諸経費'],
]

export default function EstimateTab() {
  const [newMargin, setNewMargin] = useState(DEFAULT_MARGIN)
  const [view, setView] = useState<'items' | 'costs'>('items')
  const [selId, setSelId] = useState<string | null>(null)

  useEffect(() => { ensureEstimate() }, [])

  const estimates = (useLiveQuery(() => db.estimates.toArray(), []) ?? [])
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const allItems = useLiveQuery(() => db.estimateItems.toArray(), []) ?? []
  const costs = (useLiveQuery(() => db.costs.toArray(), []) ?? [])
    .sort((a, b) => b.incurredAt.localeCompare(a.incurredAt))
  const takeoffs = useLiveQuery(() => db.takeoffs.toArray(), []) ?? []
  const tkById = new Map(takeoffs.map((t) => [t.id, t]))

  const contract = estimates.find((e) => e.type === 'contract')
  const selected: Estimate | undefined =
    estimates.find((e) => e.id === selId) ?? contract ?? pickEditable(estimates) ?? estimates[0]
  const locked = selected?.status === 'locked' || selected?.status === 'superseded'
  const items = allItems.filter((i) => i.estimateId === selected?.id)

  // 金額集計スコープ（契約＋凍結済み追加変更 / 契約前は編集中見積）
  const scope = pickScope(estimates)
  const scopeItems = allItems.filter((i) => scope.some((e) => e.id === i.estimateId))
  const scopeTotal = scope.reduce((s, e) => {
    const t = computeTotals(allItems.filter((i) => i.estimateId === e.id), e.taxRate, e.discount)
    return s + t.total
  }, 0)
  const costTotal = costs.reduce((s, c) => s + c.amount, 0)

  const taxRate = selected?.taxRate ?? 0.1
  const discount = selected?.discount ?? 0
  const totals = computeTotals(items, taxRate, discount)

  const sortItems = (a: EstimateItem, b: EstimateItem) => a.sortNo - b.sortNo
  const majors = items.filter((i) => i.type === 'major').sort(sortItems)
  const sectionsOf = (pid: string) => items.filter((i) => i.type === 'section' && i.parentId === pid).sort(sortItems)
  const itemsOf = (pid: string) => items.filter((i) => i.type === 'item' && i.parentId === pid).sort(sortItems)
  const num = (v: number | undefined) => v ?? 0

  // 大項目配下の実績原価（明細割付の合計）
  const actualOfMajor = (majorId: string) => {
    const ids = new Set<string>()
    const walk = (pid: string) => {
      for (const c of items.filter((i) => i.parentId === pid)) {
        if (c.type === 'item') ids.add(c.id)
        else walk(c.id)
      }
    }
    walk(majorId)
    return costs.filter((c) => c.estimateItemId && ids.has(c.estimateItemId))
      .reduce((s, c) => s + c.amount, 0)
  }

  const doConfirmContract = async () => {
    if (!selected) return
    if (!window.confirm(
      `「${selected.label}」を契約版として確定します。\n確定後この版は編集できません（変更は「追加変更」で積みます）。よろしいですか？`)) return
    const id = await confirmContract(selected.id)
    setSelId(id)
  }

  const doChangeOrder = async () => {
    const id = await createChangeOrder()
    setSelId(id)
    setView('items')
  }

  const doLock = async () => {
    if (!selected) return
    if (!window.confirm(`「${selected.label}」を確定（凍結）します。以後編集できません。よろしいですか？`)) return
    await lockEstimate(selected.id)
  }

  const verLabel = (e: Estimate) =>
    `${e.label}${e.status === 'locked' ? ' 🔒' : e.status === 'superseded' ? '（旧）' : ''}`

  return (
    <div className="est">
      <div className="est-toolbar no-print">
        <div className="est-title">
          <div className="ver-pills">
            {estimates.map((e) => (
              <button key={e.id}
                className={`pill ${e.id === selected?.id ? 'on' : ''} ${e.status === 'superseded' ? 'old' : ''}`}
                onClick={() => setSelId(e.id)}>
                {verLabel(e)}
              </button>
            ))}
          </div>
          {selected?.type === 'quote' && !contract && selected.status !== 'superseded' && (
            <button className="ctr" onClick={doConfirmContract}>📜 契約に確定</button>
          )}
          {contract && <button className="ctr" onClick={doChangeOrder}>＋追加変更</button>}
          {selected?.type === 'change_order' && selected.status === 'draft' && (
            <button className="ctr" onClick={doLock}>🔒 確定(凍結)</button>
          )}
        </div>
        <div className="est-controls">
          <div className="subtabs">
            <button className={view === 'items' ? 'on' : ''} onClick={() => setView('items')}>明細</button>
            <button className={view === 'costs' ? 'on' : ''} onClick={() => setView('costs')}>実績原価 ({costs.length})</button>
          </div>
          {view === 'items' && !locked && (
            <>
              <label>既定粗利率
                <input type="number" value={Math.round(newMargin * 1000) / 10} step={1}
                  onChange={(e) => setNewMargin(Number(e.target.value) / 100)} />%
              </label>
              <label>消費税
                <NumberField value={Math.round(taxRate * 100)} step={1}
                  onCommit={(v) => selected && updateEstimate(selected.id, { taxRate: v / 100 })} />%
              </label>
              <label>値引
                <NumberField value={discount} step={1000}
                  onCommit={(v) => selected && updateEstimate(selected.id, { discount: v })} />円
              </label>
            </>
          )}
          {view === 'items' && (
            <>
              <button onClick={() => window.print()}>🖶 印刷 / PDF</button>
              {!locked && selected && (
                <button className="primary" onClick={() => addNode(selected.id, 'major', null, '大項目')}>＋ 大項目</button>
              )}
            </>
          )}
        </div>
      </div>

      {contract && (
        <div className="contract-bar no-print">
          請負合計 <b>{yen(scopeTotal)}</b>
          <span className="muted">＝ 契約 {yen(computeTotals(allItems.filter((i) => i.estimateId === contract.id), contract.taxRate, contract.discount).total)}
            {scope.length > 1 && ` ＋ 追加変更 ${yen(scopeTotal - computeTotals(allItems.filter((i) => i.estimateId === contract.id), contract.taxRate, contract.discount).total)}`}</span>
          <span className="spacer" />
          実績原価 <b>{yen(costTotal)}</b>
        </div>
      )}

      {view === 'items' && (
        <>
          {locked && (
            <div className="locked-note no-print">
              {selected?.status === 'superseded'
                ? 'この版は旧版（失効）です。閲覧のみできます。'
                : 'この版は確定済み（凍結）のため編集できません。変更は「＋追加変更」で積んでください。'}
            </div>
          )}
          <div className="est-body">
            {majors.length === 0 && (
              <p className="muted empty">
                {selected?.type === 'change_order'
                  ? 'この追加変更はまだ空です。「＋大項目」から増減の明細を入れてください（減額はマイナス数量）。'
                  : '「＋ 大項目」から工種（例：内装工事）を追加し、中項目 → 明細と入力してください。'}
              </p>
            )}

            {majors.map((major) => {
              const ms = subtreeSum(items, major.id)
              const actual = actualOfMajor(major.id)
              return (
                <div className="major" key={major.id}>
                  <div className="major-head">
                    <TextField className="name" value={major.name} disabled={locked}
                      onCommit={(v) => updateNode(major.id, { name: v })} />
                    <span className="sub">
                      売 {yen(ms.sell)} / 予算原価 {yen(ms.cost)}
                      {actual > 0 && <> / <b className={actual > ms.cost ? 'over' : ''}>実績 {yen(actual)}</b></>}
                    </span>
                    {!locked && <button onClick={() => addNode(selected!.id, 'section', major.id, '中項目')}>＋中項目</button>}
                    {!locked && <button className="del" onClick={() => deleteNode(major.id)}>🗑</button>}
                  </div>

                  {sectionsOf(major.id).map((section) => {
                    const ss = subtreeSum(items, section.id)
                    return (
                      <div className="section" key={section.id}>
                        <div className="section-head">
                          <TextField className="name" value={section.name} disabled={locked}
                            onCommit={(v) => updateNode(section.id, { name: v })} />
                          <span className="sub">売 {yen(ss.sell)} / 原価 {yen(ss.cost)}</span>
                          {!locked && <button onClick={() => addNode(selected!.id, 'item', section.id, '項目', newMargin)}>＋明細</button>}
                          {!locked && <button className="del" onClick={() => deleteNode(section.id)}>🗑</button>}
                        </div>

                        <div className="item-head">
                          <span>名称</span><span>数量</span><span>単位</span>
                          <span>原価単価</span><span>粗利率</span><span>売単価</span>
                          <span>金額</span><span>粗利</span><span></span>
                        </div>

                        {itemsOf(section.id).map((it) => (
                          <div className="item-row" key={it.id}>
                            <TextField value={it.name} disabled={locked}
                              onCommit={(v) => editItemField(it, 'name', v)} />
                            <div className="qty-cell">
                              <NumberField value={num(it.quantity)} step={1} disabled={locked}
                                onCommit={(v) => editItemField(it, 'quantity', v)} />
                              {(() => {
                                if (!it.sourceTakeoffId || locked) return null
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
                            <TextField value={it.unit ?? ''} disabled={locked}
                              onCommit={(v) => editItemField(it, 'unit', v)} />
                            <NumberField value={num(it.costUnitPrice)} step={100} disabled={locked}
                              onCommit={(v) => editItemField(it, 'costUnitPrice', v)} />
                            <NumberField value={Math.round(num(it.marginRate) * 1000) / 10} step={1} disabled={locked}
                              onCommit={(v) => editItemField(it, 'marginRate', v / 100)} />
                            <NumberField value={num(it.unitPrice)} step={100} disabled={locked}
                              onCommit={(v) => editItemField(it, 'unitPrice', v)} />
                            <span className="amount">{yen(itemSell(it))}</span>
                            <span className="profit">{yen(itemSell(it) - itemCost(it))}</span>
                            {!locked ? <button className="del" onClick={() => deleteNode(it.id)}>🗑</button> : <span />}
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
        </>
      )}

      {view === 'costs' && (
        <CostsView costs={costs} scopeItems={scopeItems} costTotal={costTotal} />
      )}
    </div>
  )
}

// ---- 実績原価ビュー ----
function CostsView({ costs, scopeItems, costTotal }: {
  costs: Cost[]
  scopeItems: EstimateItem[]
  costTotal: number
}) {
  const majors = scopeItems.filter((i) => i.type === 'major').sort((a, b) => a.sortNo - b.sortNo)
  const itemsUnder = (majorId: string): EstimateItem[] => {
    const out: EstimateItem[] = []
    const walk = (pid: string) => {
      for (const c of scopeItems.filter((i) => i.parentId === pid).sort((a, b) => a.sortNo - b.sortNo)) {
        if (c.type === 'item') out.push(c)
        else walk(c.id)
      }
    }
    walk(majorId)
    return out
  }

  return (
    <div className="est-body">
      <div className="costs-toolbar">
        <p className="muted">実費（材料・手間・外注・諸経費）を記録すると、ヘッダの「実績原価」「粗利(残)」に即反映されます。割付先を選ぶと工種別の予実が出ます。</p>
        <button className="primary" onClick={() => addCost()}>＋ 実費を記録</button>
      </div>

      {costs.length === 0 && <p className="muted empty">まだ実費がありません。「＋実費を記録」から入力してください。</p>}

      {costs.length > 0 && (
        <div className="cost-head">
          <span>日付</span><span>費目</span><span>内容</span><span>支払先</span><span>割付先（見積明細）</span><span>金額</span><span></span>
        </div>
      )}
      {costs.map((c) => (
        <div className="cost-row" key={c.id}>
          <input type="date" value={c.incurredAt}
            onChange={(e) => updateCost(c.id, { incurredAt: e.target.value })} />
          <select value={c.kind} onChange={(e) => updateCost(c.id, { kind: e.target.value as CostKind })}>
            {COST_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <TextField placeholder="内容（例: クロス材）" value={c.title}
            onCommit={(v) => updateCost(c.id, { title: v })} />
          <TextField placeholder="支払先" value={c.vendorName ?? ''}
            onCommit={(v) => updateCost(c.id, { vendorName: v })} />
          <select value={c.estimateItemId ?? ''}
            onChange={(e) => updateCost(c.id, { estimateItemId: e.target.value || undefined })}>
            <option value="">（現場共通費）</option>
            {majors.map((m) => (
              <optgroup key={m.id} label={m.name}>
                {itemsUnder(m.id).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </optgroup>
            ))}
          </select>
          <NumberField value={c.amount} step={1000}
            onCommit={(v) => updateCost(c.id, { amount: v })} />
          <button className="del" onClick={() => deleteCost(c.id)}>🗑</button>
        </div>
      ))}

      {costs.length > 0 && (
        <div className="cost-total">実績原価合計 <b>{yen(costTotal)}</b></div>
      )}
    </div>
  )
}
