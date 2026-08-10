@echo off
rem ============================================================
rem  安阳麻将 · 无边框桌面启动器（稳健版）
rem  - 优先用 Electron 无边框窗口（自带局域网服务器 + 掷骰定庄）
rem  - 若 Electron 不可用，自动兜底：启动服务器 + 浏览器打开
rem ============================================================
setlocal
set "ROOT=C:\Users\Administrator\WorkBuddy\2026-08-06-15-08-29\anyang-mahjong"
set "ELECTRON=%ROOT%\launcher\node_modules\electron\dist\electron.exe"
set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "PORT=3000"

if exist "%ELECTRON%" (
  echo [安阳麻将] 启动无边框桌面版（Electron）...
  start "" "%ELECTRON%" "%ROOT%\launcher\main.js"
  goto :eof
)

echo [安阳麻将] Electron 不可用，改用 浏览器 + 局域网服务器 兜底...
if not exist "%NODE%" set "NODE=node"
start "" "%NODE%" "%ROOT%\server.js"
timeout /t 2 >nul
start "" http://localhost:%PORT%
goto :eof
