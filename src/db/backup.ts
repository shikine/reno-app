import { db } from './db'
import { exportAll } from './transfer'

// 自動バックアップ：ユーザーが一度フォルダ（例: Googleドライブ内）を選ぶと、
// FileSystemDirectoryHandle を IndexedDB に保存し、以後データ変更を検知して
// JSON を自動書き出しする。Drive for Desktop がクラウドへ同期する想定。
// iPad Safari は showDirectoryPicker 未対応のため手動⬇保存のみ（UI側で非表示）。

const HANDLE_KEY = 'backupDirHandle'

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (opts: { mode: string }) => Promise<string>
  requestPermission?: (opts: { mode: string }) => Promise<string>
}

export const backupSupported = (): boolean => 'showDirectoryPicker' in window

export async function chooseBackupDir(): Promise<string> {
  const picker = (window as unknown as {
    showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  const handle = await picker({ mode: 'readwrite' })
  await db.settings.put({ key: HANDLE_KEY, value: handle })
  return handle.name
}

export async function getBackupDirName(): Promise<string | null> {
  const row = await db.settings.get(HANDLE_KEY)
  return row ? (row.value as DirHandle).name : null
}

export async function clearBackupDir(): Promise<void> {
  await db.settings.delete(HANDLE_KEY)
}

// exportedAt を除いて比較し、実データが変わった時だけ書き込む
const stripStamp = (json: string) => json.replace(/"exportedAt":\s*"[^"]*",?/, '')
let lastWritten = ''

export type BackupResult = 'written' | 'unchanged' | 'no-dir' | 'denied' | 'error'

export async function runBackup(force = false): Promise<BackupResult> {
  const row = await db.settings.get(HANDLE_KEY)
  if (!row) return 'no-dir'
  const handle = row.value as DirHandle

  const json = await exportAll()
  if (!force && stripStamp(json) === lastWritten) return 'unchanged'

  try {
    if (handle.queryPermission) {
      let perm = await handle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted' && handle.requestPermission) {
        perm = await handle.requestPermission({ mode: 'readwrite' })
      }
      if (perm !== 'granted') return 'denied'
    }
    const write = async (name: string) => {
      const fh = await handle.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(json)
      await w.close()
    }
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    await write('reno-backup-latest.json')   // 常に最新
    await write(`reno-backup-${stamp}.json`) // 日次の履歴
    lastWritten = stripStamp(json)
    return 'written'
  } catch (e) {
    console.error('backup failed', e)
    return 'error'
  }
}
