@echo off
rem === リノベ作図アプリ 起動 ===
cd /d "C:\Users\watan\reno-app"

rem 3秒後にブラウザを開く（サーバ起動を待つ）
start "" cmd /c "timeout /t 3 >nul & start "" http://localhost:5180/"

rem 開発サーバを起動（このウィンドウを閉じると停止します）
npm run dev
