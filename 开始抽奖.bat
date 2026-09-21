@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo 正在安装依赖...
  call npm install
)
echo 正在启动婚礼抽奖
echo 大屏展示: http://localhost:3780/screen
echo 手机控制: http://localhost:3780/control
echo 宾客领号: http://localhost:3780
echo 宾客扫码: http://816.gjsgj.com/
start "" http://localhost:3780/screen
node server.js
pause
