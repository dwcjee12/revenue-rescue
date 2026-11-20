@echo off
setlocal
cd /d "%~dp0"
title Revenue Rescue - publish to GitHub
echo Create an EMPTY repository on github.com first (no README, no .gitignore), then paste its URL below.
echo Example: https://github.com/yourname/revenue-rescue.git
echo.
set /p REPO=Repository URL: 
if "%REPO%"=="" goto end
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "Update" >nul 2>nul
git remote remove origin >nul 2>nul
git remote add origin %REPO%
echo.
echo Pushing code. A browser window may open so you can sign in to GitHub.
git push -u origin main
if errorlevel 1 goto fail
echo.
set /p TAGIT=Push tag v0.2.1 now to build the Windows, Mac and Linux installers online? (y/n): 
if /i not "%TAGIT%"=="y" goto done
git tag -f v0.2.1
git push origin v0.2.1 --force
:done
echo.
echo Done. Open the repository's Actions tab to watch the builds; installers appear under Releases.
goto end
:fail
echo.
echo Push did not finish. Check the URL and that you signed in, then run this again.
:end
pause
