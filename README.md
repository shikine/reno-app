# リノベ案件管理アプリ (reno-app)

1人のリノベ事業者が、1案件の **作図 → 見積・経費 → 工程・進捗** を1画面で完結管理するローカルファーストWebアプリ。

## 技術構成
- React + TypeScript + Vite
- Dexie (IndexedDB) — ブラウザ内にローカル保存、オフライン動作
- SVG手実装の作図（部屋→面積→数量拾い→見積連携）
- 静的PWA想定（サーバ・認証なし）

## 設計の背骨
部位(Room/Wall/Opening) → 数量拾い(Takeoff) → 見積明細(EstimateItem) → 原価/工程(Task) を **ID参照**で連鎖。
作図変更は見積へ自動上書きせず「⚠差分表示 → 人が確定」の半自動方式。数量は明細側にスナップショット保持。

設計ドキュメント: `G:\マイドライブ\_事業\リノベアプリ\docs\`（要件仕様・データモデル・技術選定・画面設計）

## 開発
```bash
npm install
npm run dev    # http://localhost:5180
npm run build  # tsc + vite build
```

### 注意（開発環境）
Google Drive 上では `node_modules` が動作しないため、このリポジトリは
ローカルディスク（`C:\Users\watan\reno-app`）で開発する。

## データ管理
- 本体データはブラウザの IndexedDB
- ヘッダ「⬇保存 / ⬆読込」で全データのJSONエクスポート/インポート
- 「🗂 自動バックアップ」でフォルダ（例: Googleドライブ内）を指定すると、
  変更検知で `reno-backup-latest.json`＋日次ファイルを自動書き出し
