# Changelog

## 0.2.1
- Desktop app retries the first page load (slow first start under antivirus scanning).

## 0.2.0
- Desktop app: update checks (File → Check for updates…), single instance, OS-keychain key wrapping.
- GitHub Actions: CI on every push; tagged releases build Windows, macOS and Linux installers.
- Docker Compose + Caddy for an HTTPS team server; `/healthz` for uptime checks.
- Windows helper scripts: `start-revenue-rescue.bat`, `build-windows-installer.bat`, `setup-git.bat`.
- Richer sample data (8 quotes across every priority lane).

## 0.1.0
- Multi-page platform: pipeline, inbox, follow-up plan, outreach, contracts, integrations, developer API, team, settings.
- Approval-gated sending, opt-out handling, signed webhooks, encrypted provider credentials.
