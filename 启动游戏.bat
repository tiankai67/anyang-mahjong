@echo off
chcp 65001 >nul
echo ============================
echo   安阳麻将在线组局游戏
echo ============================
echo.
echo 正在启动服务器...
echo.
cd /d "%~dp0"
node server.js
pause
