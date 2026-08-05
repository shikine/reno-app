// Google Apps Script Web App を叩くクラウドDBクライアント。
//
// POST は Content-Type: text/plain で送る（application/json だと CORS プリフライトが
// 発生し、Apps Script が OPTIONS を返せず失敗するため）。GET は素のクエリで叩く。

import { GAS_URL, GAS_TOKEN, cloudReady } from './config'

export interface SurveyRecord {
  id: string
  createdAt: string
  projectName: string
  customerName: string
  respondent: string
  summary: string
  answers: Record<string, unknown>
}

export interface EstimateSummary {
  id: string
  savedAt: string
  projectName: string
  label: string
  type: string
  total: number
  sell: number
  cost: number
}

export interface EstimateSnapshot extends EstimateSummary {
  data: {
    taxRate?: number
    discount?: number
    items?: Array<{
      type: string
      name: string
      spec?: string
      unit?: string
      quantity?: number
      unitPrice?: number
      amount?: number
      depth: number
    }>
  }
}

function ensureConfigured(): void {
  if (!cloudReady()) throw new Error('クラウド接続先(GAS_URL)が未設定です。設定手順をご確認ください。')
}

async function post<T>(action: string, payload: unknown): Promise<T> {
  ensureConfigured()
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: GAS_TOKEN, payload }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || '保存に失敗しました')
  return data as T
}

async function get<T>(params: Record<string, string>): Promise<T> {
  ensureConfigured()
  const url = new URL(GAS_URL)
  if (GAS_TOKEN) url.searchParams.set('token', GAS_TOKEN)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || '取得に失敗しました')
  return data as T
}

// ---- アンケート ----

export interface SurveyInput {
  projectName: string
  customerName: string
  respondent: string
  summary: string
  answers: Record<string, unknown>
}

export async function addSurvey(input: SurveyInput): Promise<string> {
  const r = await post<{ id: string }>('survey.add', input)
  return r.id
}

export async function listSurveys(projectName?: string): Promise<SurveyRecord[]> {
  const params: Record<string, string> = { action: 'survey.list' }
  if (projectName) params.projectName = projectName
  const r = await get<{ items: SurveyRecord[] }>(params)
  return r.items
}

// ---- 見積スナップショット ----

export interface EstimateSaveInput {
  id?: string
  projectName: string
  label: string
  type: string
  total: number
  sell: number
  cost: number
  data: EstimateSnapshot['data']
}

export async function saveEstimate(input: EstimateSaveInput): Promise<string> {
  const r = await post<{ id: string }>('estimate.save', input)
  return r.id
}

export async function listEstimates(projectName?: string): Promise<EstimateSummary[]> {
  const params: Record<string, string> = { action: 'estimate.list' }
  if (projectName) params.projectName = projectName
  const r = await get<{ items: EstimateSummary[] }>(params)
  return r.items
}

export async function getEstimate(id: string): Promise<EstimateSnapshot | null> {
  const r = await get<{ item: EstimateSnapshot | null }>({ action: 'estimate.get', id })
  return r.item
}
