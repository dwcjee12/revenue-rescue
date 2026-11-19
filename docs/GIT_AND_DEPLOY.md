# Git, releases and hosting

Everything below is done once. After that, shipping = commit, tag, push.

## 1. Put the project in Git
```bash
cd rr-platform
git init -b main            # already done if you unzipped a repo
git add . && git commit -m "Revenue Rescue platform"
```
Create an empty repo on GitHub (no README), then:
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
`.gitignore` already keeps `node_modules/`, `dist/`, `data/` (your database) and `.env` (secrets) out of Git. **Never commit `.env` or `data/`.**
A **private** repo is fine for CI; for installer auto-update either make Releases public or accept manual updates (a private feed needs a token inside the app, which we don't recommend).

## 2. Continuous checks
`.github/workflows/ci.yml` runs `npm test` (73 checks against a mock of the provider APIs) on every push and pull request. Protect `main` (Settings → Branches) so merges need a green check.

## 3. Release installers (Windows, Mac, Linux)
1. Bump `version` in `package.json`.
2. `git commit -am "v0.2.0" && git tag v0.2.0 && git push && git push --tags`
3. `.github/workflows/release.yml` builds `.exe`, `.dmg`, `.AppImage` and `.deb` on three runners and attaches them to a GitHub Release (it uses the built-in `GITHUB_TOKEN`; no setup).
4. Share the Release page link. Installed copies find new versions themselves (menu **File → Check for updates…**, and a quiet check 15 s after launch). `.deb` installs do not self-update; AppImage, Windows and Mac do.

**Signing (optional but recommended).** Unsigned installers work but show "unknown publisher" (Windows SmartScreen) or are blocked by Gatekeeper (Mac). Add repository secrets: Windows `CSC_LINK` (base64 .pfx) + `CSC_KEY_PASSWORD`; Mac `CSC_LINK`/`CSC_KEY_PASSWORD` for a Developer ID cert plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization. Mac auto-update requires a signed app.

## 4. Host the server (for teams, web login and webhooks)
Desktop installs run their own private copy. For a shared team server:
```bash
cp .env.example .env        # fill in below
echo "DOMAIN=rescue.yourcompany.com" >> .env
docker compose up -d --build
```
Point the domain's DNS A record at the machine first; Caddy gets the HTTPS certificate automatically. Works on any VPS (Hetzner, DigitalOcean, EC2). Fly.io/Render/Railway also work with the Dockerfile — mount a persistent volume at `/data`.

`.env` essentials:
| Variable | Value |
|---|---|
| `BASE_URL` | `https://rescue.yourcompany.com` (exactly your public URL) |
| `ENCRYPTION_KEY` | 64 hex chars: `openssl rand -hex 32`. **Back it up** — without it saved provider logins can't be decrypted |
| `<PROVIDER>_CLIENT_ID` / `_SECRET` | one pair per sign-in you want (Google, Microsoft, HubSpot, Slack, …) |
| `ALLOW_APP_CREDS_UI` | `1` lets an owner paste those keys in the app instead of `.env` |

Back up the `appdata` volume (SQLite file) regularly: `docker compose cp app:/data ./backup`.

## 5. Register each provider (once per provider)
- OAuth redirect URI: `BASE_URL/oauth/callback/<provider>` (the Integrations page shows the exact one).
- Twilio inbound texts: set the number's webhook to `BASE_URL/hooks/twilio/<workspace id>` (shown on the Integrations page). The desktop app polls instead.
- DocuSign / Dropbox Sign: the app polls status; no webhook needed.

## 6. Point desktop installs at the server
Open the installed app → **File → Server settings** → enter `https://rescue.yourcompany.com`. Everyone then shares one workspace. Leave it blank to stay on the private local copy.

## 7. Updating the server
```bash
git pull && docker compose up -d --build
```
The database migrates itself on start.

## What is not verified
Auto-update, the Windows and Mac builds, signing, and live provider accounts were not exercised in the build environment (only the Linux build and a mock of the provider APIs were).
