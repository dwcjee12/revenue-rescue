# Security

Report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab, not in a public issue.

What the app protects by design:
- Provider credentials are encrypted at rest (AES-256-GCM) with a key that stays on your computer or server.
- Nothing is sent to a customer without human approval, and opt-outs are honoured globally.
- Passwords are hashed with scrypt; sessions use cookies with CSRF protection.

Keep your `.env`, backups and `ENCRYPTION_KEY` private. Anyone with a backup and the key can read saved connections.
