// LIFF（LINE内ブラウザ）連携。SDKは index.html の <script> で読み込む。
// LINE外の通常ブラウザでも動くように、失敗しても例外を投げず握りつぶす（アプリはPCでも使うため）。

import { LIFF_ID, liffReady } from './config'

export interface LineUser {
  userId: string
  displayName: string
  pictureUrl?: string
}

let profile: LineUser | null = null
let initialized = false

export async function initLiff(): Promise<void> {
  if (initialized || !liffReady() || !window.liff) return
  initialized = true
  try {
    await window.liff.init({ liffId: LIFF_ID })
    // LINEアプリ内で未ログインなら自動ログイン、外部ブラウザでは何もしない
    if (window.liff.isInClient() && !window.liff.isLoggedIn()) {
      window.liff.login()
      return
    }
    if (window.liff.isLoggedIn()) {
      profile = await window.liff.getProfile()
    }
  } catch (e) {
    // LIFF未設定・ネット不通でもアプリ本体は使えるようにする
    console.warn('LIFF init skipped:', e)
  }
}

export function getLineUser(): LineUser | null {
  return profile
}

// クラウド呼び出しに付与する LIFF IDトークン（未ログイン/LINE外では null）
export function getIdToken(): string | null {
  try {
    return window.liff?.getIDToken() ?? null
  } catch {
    return null
  }
}

// LINEログインを促す（外部ブラウザでも動く）。ログイン済みなら true。
export function ensureLogin(): boolean {
  if (!liffReady() || !window.liff) return false
  if (window.liff.isLoggedIn()) return true
  window.liff.login()
  return false
}

export function isLineLoggedIn(): boolean {
  try {
    return Boolean(window.liff?.isLoggedIn())
  } catch {
    return false
  }
}

// URL の ?view=survey / ?view=estimate を読む（リッチメニューからの遷移先切替に使う）
export function initialView(): 'record' | 'list' | 'estimate' | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view')
    if (v === 'survey' || v === 'record') return 'record'
    if (v === 'list') return 'list'
    if (v === 'estimate') return 'estimate'
  } catch { /* noop */ }
  return null
}
