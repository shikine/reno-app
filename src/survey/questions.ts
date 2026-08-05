// 現地調査アンケートの設問定義。ここを編集すれば設問を自由に増減できる。
// answers はこの id をキーに保存される（スプレッドシートの answersJson）。

export type QuestionType = 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'date'

export interface Question {
  id: string
  label: string
  type: QuestionType
  options?: string[]     // select / multiselect 用
  required?: boolean
  placeholder?: string
  unit?: string          // number の後ろに表示（円・年 など）
}

export const SURVEY_TITLE = '現地調査アンケート'

export const QUESTIONS: Question[] = [
  { id: 'surveyDate', label: '調査日', type: 'date', required: true },
  {
    id: 'targetParts', label: '対象部位', type: 'multiselect',
    options: ['キッチン', '浴室', 'トイレ', '洗面', 'LDK', '居室', '玄関', '廊下', '外壁', '屋根', '外構', 'その他'],
  },
  { id: 'buildingAge', label: '築年数', type: 'number', unit: '年', placeholder: '例: 25' },
  {
    id: 'structure', label: '構造', type: 'select',
    options: ['木造', '鉄骨造', 'RC造', '不明'],
  },
  { id: 'currentIssues', label: '現況の劣化・不具合', type: 'textarea', placeholder: '雨漏り・水回りの傷み・床鳴り など' },
  { id: 'request', label: 'お客様のご要望', type: 'textarea', placeholder: 'こうしたい・こう変えたい' },
  { id: 'budget', label: '概算ご予算', type: 'number', unit: '円', placeholder: '例: 3000000' },
  { id: 'desiredTiming', label: '希望時期', type: 'text', placeholder: '例: 今秋 / 未定' },
  { id: 'note', label: 'その他メモ', type: 'textarea' },
]

// 記録一覧の1行に出す「まとめ文」を作る（スプレッドシートでも読めるように）
export function buildSummary(answers: Record<string, unknown>): string {
  const parts: string[] = []
  for (const q of QUESTIONS) {
    const v = answers[q.id]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    const shown = Array.isArray(v) ? v.join('・') : String(v)
    parts.push(`${q.label}: ${shown}`)
  }
  return parts.join(' / ')
}
