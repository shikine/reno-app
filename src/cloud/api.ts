// Google Apps Script Web App を叩くクラウドDBクライアント。
//
// すべて POST（Content-Type: text/plain）で送る。application/json だと CORS プリフライトが
// 発生し Apps Script が OPTIONS を返せず失敗するため text/plain を使う。
// 認証は LIFF IDトークン（あれば）＋ 静的トークン（当面のフォールバック）。

import { GAS_URL, GAS_TOKEN, cloudReady } from './config'
import { getIdToken } from './liff'

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

// 全リクエスト共通。action と任意の追加フィールドを本文に載せ、認証情報を付与して POST する。
async function rpc<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  ensureConfigured()
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: GAS_TOKEN, idToken: getIdToken(), ...extra }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || '通信に失敗しました')
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
  const r = await rpc<{ id: string }>('survey.add', { payload: input })
  return r.id
}

export async function updateSurvey(id: string, input: SurveyInput): Promise<void> {
  await rpc('survey.update', { id, payload: input })
}

export async function deleteSurvey(id: string): Promise<void> {
  await rpc('survey.delete', { id })
}

export async function listSurveys(projectName?: string): Promise<SurveyRecord[]> {
  const r = await rpc<{ items: SurveyRecord[] }>('survey.list', projectName ? { projectName } : {})
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
  const r = await rpc<{ id: string }>('estimate.save', { payload: input })
  return r.id
}

export async function listEstimates(projectName?: string): Promise<EstimateSummary[]> {
  const r = await rpc<{ items: EstimateSummary[] }>('estimate.list', projectName ? { projectName } : {})
  return r.items
}

export async function getEstimate(id: string): Promise<EstimateSnapshot | null> {
  const r = await rpc<{ item: EstimateSnapshot | null }>('estimate.get', { id })
  return r.item
}
