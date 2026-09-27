@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请安装 Node.js 20 或更新版本后再试。
  pause
  exit /b 1
)
echo 正在上传最近一次 Cocos 微信构建的远程资源，并验证公开下载...
node scripts/publish-wechat-cdn.cjs
set SWIMMING_RESULT=%ERRORLEVEL%
if "%SWIMMING_RESULT%"=="0" (
  echo 完成：可以回到微信开发者工具上传对应代码包。
) else (
  echo 未完成：请查看上方错误；资源发布成功前不要上传新代码包。
  echo 首次使用或登录过期时，请先执行 pnpm cdn:login。
)
pause
exit /b %SWIMMING_RESULT%
