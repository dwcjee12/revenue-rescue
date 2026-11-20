@echo off
cd /d "%~dp0"
echo Applying fixed release workflow...
if not exist .github\workflows mkdir .github\workflows
copy /Y release.yml.fixed .github\workflows\release.yml >nul
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "Fix release workflow YAML; add provider setup guide"
git push origin main
echo Re-tagging v0.2.1 so the installers build...
git tag -d v0.2.1 >nul 2>&1
git push origin :refs/tags/v0.2.1 >nul 2>&1
git tag v0.2.1
git push origin v0.2.1
echo.
echo Done. Open https://github.com/dwcjee12/revenue-rescue/actions to watch the build (about 10 minutes).
pause
