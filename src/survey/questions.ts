// 工事進捗 日報の設問定義。物件は固定（烏帽子）で毎回聞かない。
// answers はこの id をキーに保存される（スプレッドシートの answersJson）。

export type QuestionType =
  | 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'date' | 'time' | 'workitems'

export interface Question {
  id: string
  label: string
  type: QuestionType
  options?: string[]     // select / multiselect 用
  required?: boolean
  placeholder?: string
  unit?: string          // number の後ろに表示
  default?: string       // 既定値。date は 'today' で今日
}

// 記録をまとめる物件（固定）。物件が変わる場合はここを変更。
export const FIXED_PROJECT = '烏帽子家'

export const SURVEY_TITLE = '工事進捗 日報'

export const QUESTIONS: Question[] = [
  { id: 'workDate', label: '日付', type: 'date', required: true, default: 'today' },
  {
    id: 'workers', label: '来た人（複数選択可）', type: 'multiselect',
    options: ['安崎さん', 'お手伝い', '設備', '左官', 'その他'],
  },
  { id: 'startTime', label: '開始時刻', type: 'time', default: '08:00' },
  { id: 'endTime', label: '終了時刻', type: 'time', default: '17:00' },
  { id: 'workItems', label: '何をしたか（見積の項目から選択）', type: 'workitems' },
  { id: 'note', label: 'メモ', type: 'textarea', placeholder: '特記事項・気づき など' },
]

// 記録一覧の1行に出す「まとめ文」を作る（スプレッドシートでも読めるように）
export function buildSummary(answers: Record<string, unknown>): string {
  const parts: string[] = []
  for (const q of QUESTIONS) {
    const v = answers[q.id]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    const shown = Array.isArray(v) ? v.join('・') : String(v)
    parts.push(`${q.label.replace(/（.*?）/g, '')}: ${shown}`)
  }
  return parts.join(' / ')
}
