// 烏帽子家 サッシ建具表（250928 サッシお見積り より）。
// size は呼称からの目安。正確な製作寸法は発注時にメーカー確認。

export interface WindowSpec {
  id: string        // AW1 / AD1
  type: string      // 種類
  code: string      // 品番/呼称
  size: string      // 目安サイズ（幅×高 mm）
  func?: string     // 機能
  glass?: string    // ガラス
  screen?: string   // 網戸
  place: string     // 設置場所
  note?: string     // 備考
}

export const WINDOWS: WindowSpec[] = [
  { id: 'インプラス1・2', type: 'インプラス窓（内窓）', code: '—', size: '見積もり済み', screen: '無', place: '昭和の家 2F', note: '見積もり済み' },
  { id: 'AW1', type: '横すべり出し窓', code: '96093', size: '要確認（呼称から特定不可）', func: 'オペレーター', glass: '透明', screen: '有り', place: 'キッチン' },
  { id: 'AW2', type: '窓', code: '—', size: '見積もり済み', glass: '', screen: '有り', place: '洋室', note: '見積もり済み' },
  { id: 'AW3', type: '窓', code: '—', size: '見積もり済み', screen: '有り', place: 'リビング', note: '見積もり済み' },
  { id: 'AW4', type: '窓', code: '—', size: '見積もり済み', screen: '有り', place: 'リビング', note: '見積もり済み' },
  { id: 'AW5', type: '単体引き違い窓', code: '16507', size: '約1650×770', glass: '透明', screen: '有り', place: 'リビング' },
  { id: 'AW6', type: '単体引き違い窓', code: '16507', size: '約1650×770', glass: '透明', screen: '有り', place: 'リビング' },
  { id: 'AW7', type: '単体引き違い窓', code: '11907', size: '約1190×770', glass: '透明', screen: '有り', place: '寝室' },
  { id: 'AW8', type: '単体引き違い窓', code: '11907', size: '約1190×770', glass: '透明', screen: '有り', place: '寝室' },
  { id: 'AW9', type: '縦すべり出し窓', code: '特注 W600 H770（L）', size: '600×770', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: 'キッチン' },
  { id: 'AW10', type: '縦すべり出し窓', code: '特注 W600 H770（L）', size: '600×770', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: 'キッチン' },
  { id: 'AW11', type: '縦すべり出し窓', code: '特注 W600 H770（R）', size: '600×770', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: 'キッチン' },
  { id: 'AW12', type: '縦すべり出し窓', code: '特注 W600 H770（R）', size: '600×770', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: 'キッチン' },
  { id: 'AW13', type: '縦すべり出し窓', code: '03609（R）', size: '約405×970', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: '脱衣室' },
  { id: 'AW14', type: '縦すべり出し窓', code: '06011（R）', size: '約640×1170', func: 'カムラッチ', glass: '透明', screen: 'プリーツ網戸', place: '浴室' },
  { id: 'AW15', type: '縦すべり出し窓', code: '06009（R）', size: '約640×970', func: 'オペレーター', glass: '透明', screen: '固定網戸', place: '土間' },
  { id: 'AW16', type: '単体引き違い窓', code: '256222', size: '約2560×2230（要確認）', glass: '透明', screen: '有り', place: '昭和の家 2F' },
  { id: 'AW17', type: '単体引き違い窓', code: '07407', size: '約780×770', glass: '透明', screen: '有り', place: 'リビング' },
  { id: 'AW18', type: '単体引き違い窓', code: '07407', size: '約780×770', glass: '透明', screen: '有り', place: 'リビング' },
  { id: 'AW19', type: '単体引き違い窓', code: '16009', size: '約1600×970', glass: '透明', screen: '有り', place: '土間' },
  { id: 'AD1', type: 'テラスドア', code: '7418（L）', size: '約780×1830', func: 'シリンダー付き', glass: '透明', screen: 'プリーツ網戸', place: 'キッチン' },
  { id: 'AD2', type: 'テラスドア', code: '7422（L）', size: '約780×2230', func: 'シリンダー無し', glass: 'フロスト', screen: 'プリーツ網戸', place: '物入れ' },
  { id: 'AD3', type: 'TW 土間スライディング', code: '16520', size: '約1650×2030', glass: '透明', screen: '有り', place: '土間', note: '中残あり' },
]

// 設置場所の一覧（重複除去・出現順）
export const WINDOW_PLACES: string[] = WINDOWS.reduce<string[]>((acc, w) => {
  if (!acc.includes(w.place)) acc.push(w.place)
  return acc
}, [])
