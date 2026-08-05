/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIFF_ID?: string
  readonly VITE_GAS_URL?: string
  readonly VITE_GAS_TOKEN?: string
}

// LIFF SDK は index.html の <script> で読み込むため、グローバルに存在する。
declare global {
  interface Window {
    liff?: {
      init(config: { liffId: string }): Promise<void>
      isLoggedIn(): boolean
      login(config?: { redirectUri?: string }): void
      isInClient(): boolean
      getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>
      getIDToken(): string | null
    }
  }
}

export {}
