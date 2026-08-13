// 工事進捗 日報の設問定義。物件は固定（烏帽子）で毎回聞かない。
// answers はこの id をキーに保存される（スプレッドシートの answersJson）。

export type QuestionType =
  | 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'date' | 'time'
  | 'workitems' | 'progress' | 'stageprogress' | 'attendance' | 'photo' | 'category'

// 記録の区分（大工／施主）。group がこの値と一致する設問だけ出す。
export const CATEGORIES = ['大工', '施主'] as const
// 施主の活動メニュー
export const OWNER_ACTS = ['デザイン提案', '配置の提案', '構造の提案', '什器・建具の購入', '図面送付', '打合せ', 'その他']

// 来た人の時間帯
export const ATTEND_SLOTS = ['午前', '午後', '全日'] as const

export interface Question {
  id: string
  label: string
  type: QuestionType
  options?: string[]     // select / multiselect 用
  required?: boolean
  placeholder?: string
  unit?: string          // number の後ろに表示
  default?: string       // 既定値。date は 'today' で今日
  group?: '大工' | '施主' // 指定時は、その区分のときだけ表示（未指定＝常に表示）
}

// 記録をまとめる物件（固定）。物件が変わる場合はここを変更。
export const FIXED_PROJECT = '烏帽子家'

export const SURVEY_TITLE = '工事進捗 日報'

export const QUESTIONS: Question[] = [
  { id: 'category', label: '記録の区分', type: 'category', options: [...CATEGORIES], required: true },
  { id: 'workDate', label: '日付', type: 'date', required: true, default: 'today' },
  // ---- 大工 ----
  {
    id: 'workers', label: '来た人（時間帯）', type: 'attendance', group: '大工',
    options: ['安崎さん', 'お手伝い', '設備', '左官', 'その他'],
  },
  { id: 'startTime', label: '開始時刻', type: 'time', default: '08:00', group: '大工' },
  { id: 'endTime', label: '終了時刻', type: 'time', default: '17:00', group: '大工' },
  { id: 'workItems', label: '何をしたか（見積の項目から選択）', type: 'workitems', group: '大工' },
  { id: 'stageProgress', label: '工程ごとの進捗', type: 'stageprogress', group: '大工' },
  // ---- 施主 ----
  { id: 'ownerActs', label: '施主がしたこと', type: 'multiselect', options: OWNER_ACTS, group: '施主' },
  { id: 'ownerDetail', label: '内容・詳細', type: 'textarea', group: '施主', placeholder: '提案内容・購入品・送った図面 など' },
  // ---- 共通 ----
  { id: 'photos', label: '現場写真（最大3枚）', type: 'photo' },
  { id: 'note', label: 'メモ', type: 'textarea', placeholder: '特記事項・気づき など' },
]

// 区分に応じて表示する設問を返す
export function questionsFor(category: unknown): Question[] {
  return QUESTIONS.filter((q) => !q.group || q.group === category)
}

// attendance（人→時間帯のマップ）を「安崎さん(全日)・設備(午前)」の文字列にする
export function formatAttendance(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const m = v as Record<string, unknown>
  return Object.keys(m).filter((k) => m[k]).map((k) => `${k}(${m[k]})`).join('・')
}

// stageProgress（工程→%のマップ）を「内装40% / 解体100%」の文字列にする
export function formatStageProgress(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const m = v as Record<string, unknown>
  return Object.keys(m).map((k) => `${k}${Number(m[k] ?? 0)}%`).join(' / ')
}

// 工程マップの平均（全体進捗）。空なら0。
export function overallProgress(v: unknown): number {
  if (!v || typeof v !== 'object') return 0
  const vals = Object.values(v as Record<string, unknown>).map((x) => Number(x ?? 0))
  if (vals.length === 0) return 0
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

// 記録一覧の1行に出す「まとめ文」を作る（スプレッドシートでも読めるように）
export function buildSummary(answers: Record<string, unknown>): string {
  const parts: string[] = []
  for (const q of QUESTIONS) {
    const v = answers[q.id]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    let shown: string
    if (q.type === 'photo') { const n = Array.isArray(v) ? v.length : 0; if (!n) continue; shown = `${n}枚` }
    else if (q.type === 'stageprogress') { shown = formatStageProgress(v); if (!shown) continue }
    else if (q.type === 'attendance') { shown = formatAttendance(v); if (!shown) continue }
    else if (Array.isArray(v)) shown = v.join('・')
    else if (q.type === 'progress') shown = `${v}%`
    else shown = String(v)
    parts.push(`${q.label.replace(/（.*?）/g, '')}: ${shown}`)
  }
  return parts.join(' / ')
}
