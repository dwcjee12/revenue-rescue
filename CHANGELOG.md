# Changelog

## 0.2.4
- Re-release of 0.2.3 with the correct version number.

## 0.2.3
- Release workflow: builds on three runners, then one job publishes the release with all installers and update feeds.

## 0.2.2
- Help menu: provider setup guide, release notes, report a problem, About (version, mode, data folder).
- Mac builds publish a ZIP and `latest-mac.yml` alongside the DMG so update checks work.
- Release workflow YAML fixed; provider setup guide added (docs/PROVIDER_SETUP.md).
- Project metadata: repository, issue tracker, license notice, security policy.

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
