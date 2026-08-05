// クラウド連携（Google Apps Script）と LIFF の設定。
// 値はビルド時の環境変数（.env の VITE_* ）から読む。未設定なら空文字。
// ローカル(dev)で一時的に上書きしたい時は localStorage に 'reno.gasUrl' 等を入れてもよい。

const ls = (k: string): string => {
  try { return localStorage.getItem(k) ?? '' } catch { return '' }
}

export const LIFF_ID = (import.meta.env.VITE_LIFF_ID ?? ls('reno.liffId')).trim()
export const GAS_URL = (import.meta.env.VITE_GAS_URL ?? ls('reno.gasUrl')).trim()
export const GAS_TOKEN = (import.meta.env.VITE_GAS_TOKEN ?? ls('reno.gasToken')).trim()

// クラウド機能（記録の追記・見積呼び出し）が使えるか
export const cloudReady = (): boolean => GAS_URL.length > 0

// LINE(LIFF) 連携が設定されているか
export const liffReady = (): boolean => LIFF_ID.length > 0
