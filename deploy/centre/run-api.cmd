@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0..\.." || exit /b 1
if not exist "deploy\centre\centre.env" exit /b 2
for /f "usebackq eol=# delims=" %%L in ("deploy\centre\centre.env") do set "%%L"
if not exist "deploy\centre\logs" mkdir "deploy\centre\logs"
for /f %%D in ('powershell.exe -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "LOG_DATE=%%D"
"C:\Program Files\nodejs\node.exe" packages\api\bin\serve.ts >> "deploy\centre\logs\api-%LOG_DATE%.log" 2>&1
exit /b %ERRORLEVEL%
