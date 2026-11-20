@echo off
cd /d "%~dp0"
copy /Y release.yml.fixed .github\workflows\release.yml >nul
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "Release workflow: report build errors as annotations; publish partial builds"
git push origin main
git push origin :refs/tags/v0.2.3
git tag -f v0.2.3
git push origin v0.2.3
echo.
echo Done.
pause
