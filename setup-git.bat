@echo off
setlocal
cd /d "%~dp0"
title Revenue Rescue - git setup
where git >nul 2>nul
if errorlevel 1 (echo Git is not installed. & goto end)
if not exist .github\workflows\ci.yml (
  echo Restoring the GitHub workflow files from the zip in Downloads...
  tar -xf "%USERPROFILE%\Downloads\revenue-rescue-platform.zip" .github
)
if not exist .git git init -b main
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "Revenue Rescue platform" 
echo.
git log --oneline -3
echo.
echo Done. Nothing was pushed. To publish: create an empty GitHub repo, then run
echo   git remote add origin https://github.com/YOU/REPO.git
echo   git push -u origin main
:end
pause
