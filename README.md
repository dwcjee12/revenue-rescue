# Revenue Rescue platform

A multi-page web app with accounts, client workspaces, roles, a quote pipeline, approval-gated outreach, contracts, a provider connection layer, signed webhooks and a public API.

## Run it
```
npm install
cp .env.example .env      # set BASE_URL and ENCRYPTION_KEY (openssl rand -hex 32)
node --env-file=.env server.js
npm test                  # 73 end-to-end checks against a local mock of the provider APIs
```
Needs Node 22.13 or newer (uses the built-in SQLite). Docker: `docker build -t rr . && docker run -p 3000:3000 -v rrdata:/data --env-file .env rr`.
Put it behind HTTPS before real use (cookies are marked Secure when BASE_URL is https).

## Pages
`/login` · `/dashboard` (setup checklist, all-workspaces view) · `/pipeline` (board, add, CSV/Excel import with column mapper, export, push to connected systems) · `/inbox` (replies, STOP handling, click-to-call) · `/plan` (follow-up schedule) · `/outreach` (approve and send, in bulk) · `/contracts` · `/integrations` and `/integration?p=<id>` · `/developer` · `/team` · `/settings` · `/account` (password, recovery codes) · `/sign` (public signing page)

## Rules the server enforces
- Nothing is sent without an approver approving it first, and only to customers marked eligible.
- Texts always end with an opt-out line. Mailchimp contacts are added as pending (double opt-in).
- Roles: owner, estimator, viewer. Owners edit what the other roles may do. Every change is in the audit log.
- Provider credentials are encrypted at rest (AES-256-GCM) and never returned to the browser.
- Webhooks are HMAC signed, only call public https addresses, and are retried twice.

## Integrations
Signing in to a provider needs an OAuth app that **you, the operator, register once** (client id and secret in `.env`). The redirect URI for each is shown on that provider's page in the app, in the form `BASE_URL/oauth/callback/<provider id>`. Workspaces then connect their own accounts by signing in. API-key providers take each workspace's own credentials.

| Provider | Connect | Actions built |
|---|---|---|
| Google Calendar, Outlook Calendar | OAuth | create follow-up event |
| Google Sheets | OAuth | append quotes to a sheet |
| Twilio | API key | send SMS |
| Resend, Mailgun | API key | send email |
| Mailchimp | API key | add contact (pending) |
| DocuSign | OAuth | send envelope |
| Dropbox Sign | API key | send signature request (test mode by default) |
| Slack | OAuth | post event notifications |
| Microsoft Teams | webhook URL | post event notifications |
| HubSpot | OAuth | upsert contact |
| Salesforce | OAuth | create lead |
| QuickBooks, Jobber, ServiceTitan, Housecall Pro, Stripe | OAuth or API key | connect and verify only |
| Zapier, Make, anything else | webhooks and `/api/v1` | signed events out, quotes in |

## How the pieces work together
- **Follow-up plan:** a schedule (default day 3, 7, 14, 30) writes drafts for quotes that are due. It skips customers who replied, opted out, or have a draft waiting. It never sends. An approver approves and sends one by one or in bulk.
- **Replies:** Twilio replies are fetched about once a minute (works on desktop with no public address) or instantly through a signature-checked webhook on a hosted server. A reply marks the quote replied and pauses the plan. STOP, UNSUBSCRIBE, CANCEL, END or QUIT marks the customer opted out; nothing can then be sent to them or called.
- **Calls:** click-to-call through Twilio rings the user first, then bridges the customer. Calls are not recorded. Status and length are pulled back and notes are saved to the conversation.
- **Contracts:** DocuSign and Dropbox Sign statuses are checked automatically every few minutes. A signing link is available for simple acknowledgments.
- **Accounts:** sign-in uses a password. Eight one-time recovery codes are shown at sign-up for password resets, since the app has no outgoing email of its own.
- **Webhooks:** failed deliveries are queued in the database and retried after 1 minute, 5 minutes, 30 minutes and 2 hours, even across restarts.

## Honest limits
- The provider adapters follow each provider's public documentation. They are tested here against a mock, not against live accounts, so run each one against a sandbox or test account before relying on it. Endpoint versions change.
- Signing links record a typed name, time, IP and a document fingerprint. That is an acknowledgment, not an identity-verified e-signature.
- ServiceTitan, Stripe and Jobber (beyond creating a client) connect and verify only.
- Inbound replies are text only. Voicemail, call recordings and MMS are not handled.
- There is no email verification and no emailed password reset; recovery codes are the reset path. Invites are shared as links. Lost recovery codes plus a lost password means an owner must be re-invited.
- SQLite suits one server. Move to Postgres to scale beyond a small team.
- Texting, calling and emailing customers is regulated (consent, opt-out, identification, calling hours). The eligibility flag records your attestation; it does not make a message compliant.

## Desktop app (installer)
The same server and pages run inside an Electron window, so there is nothing to host. Everything is stored on the computer.

- **Build installers:** `npm run dist:linux` (AppImage and .deb) works anywhere. Windows (.exe installer) needs Windows or Wine, and macOS (.dmg) needs a Mac. The included GitHub Actions workflow (`.github/workflows/build-desktop.yml`) builds all three: push the project to GitHub and run it from the Actions tab. Download the installers from the run's artifacts.
- **Run without installing:** `npm run desktop`.
- **Where data lives:** the app's user-data folder (Windows `%APPDATA%\Revenue Rescue`, macOS `~/Library/Application Support/Revenue Rescue`, Linux `~/.config/Revenue Rescue`). The key that encrypts saved connections is wrapped by the OS keychain when one is available. **File → Back up data** copies the database and key.
- **Providers:** a desktop install has no operator to register apps, so each integration page has a form for your own free developer app (client ID and secret). Register the redirect address `http://127.0.0.1:47821/oauth/callback/<provider id>` (shown on each page). Sign-in opens in your normal browser, because Google and others refuse sign-in inside embedded windows. Credential-based providers (Twilio, Resend and so on) need no app.
- **Security:** the server listens only on 127.0.0.1, rejects requests whose Host header isn't local, and the window can't navigate away from the app (external links open in your browser).
- **Shared server mode:** **File → Server settings** switches the app between this computer only and a hosted Revenue Rescue server (https address). With a shared server everyone sees the same data, on any computer. Run the same code on a server for that.
- **Not included:** auto-update (needs a place to host releases and signed builds) and code signing (Windows shows SmartScreen and macOS shows Gatekeeper warnings until you sign).

## Git, releases and hosting
See [docs/GIT_AND_DEPLOY.md](docs/GIT_AND_DEPLOY.md): push to GitHub, CI on every push, tag `v*` to build and publish Windows/Mac/Linux installers (with in-app update checks), and `docker compose up` for an HTTPS team server.
