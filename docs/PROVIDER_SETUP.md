# Connecting providers

Every connection uses **your own** account with that company. Nothing is shared or pre-connected.
Where an address says `BASE`, use `http://localhost:3000` on your own computer, or your public `https://` address on a hosted server (it must match `BASE_URL` in `.env`).

## A. Paste-a-key providers (open Integrations, click the provider, paste, Save)
| Provider | Where to get it | Paste |
|---|---|---|
| Twilio SMS | console.twilio.com → Account SID and Auth token on the dashboard; buy or verify a sending number | Account SID, Auth token, number like +15555550100 |
| Resend | resend.com → API Keys; verify your sending domain | API key, From address |
| Mailgun | mailgun.com → Sending → Domains → API keys | Private API key, domain, From |
| Mailchimp | Account → Extras → API keys; Audience → Settings for the Audience ID | API key (ends `-us1` etc.), Audience ID |
| Dropbox Sign | app.hellosign.com → API → API key | API key |
| Microsoft Teams | In a Teams channel: Workflows → "Post to a channel when a webhook request is received" | The webhook URL |
| ServiceTitan | developer.servicetitan.io → your app | Tenant ID, Client ID/secret, App key |
| Housecall Pro | Settings → API keys | API key |
| Stripe | dashboard.stripe.com → Developers → API keys → create a **restricted, read-only** key | Restricted key |

Twilio inbound replies: set the number's webhook to `BASE/hooks/twilio/<workspace id>` (shown on the Twilio page), or just let the desktop app poll.

## B. Sign-in providers (one-time operator setup, then a "Sign in" button works)
For each: create an app, set the redirect address exactly as shown, copy the client ID and secret, then either paste them in the app (Integrations → provider → "Set up sign-in", available in the desktop app or with `ALLOW_APP_CREDS_UI=1`) or put them in `.env` as `<APP>_CLIENT_ID` / `<APP>_CLIENT_SECRET` and restart.

| Provider | Console | Redirect address | Scopes the app asks for |
|---|---|---|---|
| Google Calendar | console.cloud.google.com → APIs → enable Calendar API → Credentials → OAuth client (Web) | `BASE/oauth/callback/google_calendar` | calendar.events |
| Google Sheets | same project, enable Sheets API | `BASE/oauth/callback/google_sheets` | spreadsheets |
| Outlook Calendar | entra.microsoft.com → App registrations | `BASE/oauth/callback/outlook_calendar` | Calendars.ReadWrite |
| DocuSign | developers.docusign.com → Apps and Keys (use the demo account first) | `BASE/oauth/callback/docusign` | signature |
| Slack | api.slack.com/apps → OAuth & Permissions | `BASE/oauth/callback/slack` | chat:write, channels:read |
| HubSpot | developers.hubspot.com → create app | `BASE/oauth/callback/hubspot` | contacts read/write |
| Salesforce | Setup → App Manager → New Connected App | `BASE/oauth/callback/salesforce` | api, refresh_token |
| QuickBooks | developer.intuit.com → app → Keys | `BASE/oauth/callback/quickbooks` | accounting |
| Jobber | developer.getjobber.com → create app | `BASE/oauth/callback/jobber` | (app default) |

Google and Microsoft apps start in "testing" mode: add your own email as a test user first. Public use later needs each company's app review.

## Safety rules that always apply
Nothing sends without approval and an eligible customer. SMS carries an opt-out line. Opt-outs are global. Mailchimp contacts are added as *pending*.
