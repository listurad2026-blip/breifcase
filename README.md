# 💼 Briefcase

**Send a take-home assignment to every candidate at once — one personalised email each, with a searchable record of who got what.**

Built for the bit of hiring that quietly eats an afternoon: you have a PDF brief, a
list of forty candidates for the Flutter role, and a deadline. Briefcase takes the
list, attaches the brief, personalises every email, sends them one at a time so
nobody sees anyone else's address, and remembers all of it.

```
┌─ Compose ──────────────────────┐   ┌─ Preview ──────────────┐
│ Recipients   40 valid · 2 dupes│   │ To      arjun@gmail.com│
│ Domain/Role  Flutter Developer │   │ Subject Flutter — due… │
│ Deadline     Fri 22 Aug, 11:59 │   │                        │
│ ✨ Draft it with AI            │   │ Hi Arjun,              │
│ 📎 flutter-task.pdf            │   │ …                      │
└────────────────────────────────┘   └────────────────────────┘
```

---

## What it does

- **Paste any list.** Commas, spaces, new lines, `Name <email>`, or rows copied
  straight out of Excel. Duplicates removed, names extracted, bad addresses
  reported back rather than silently dropped.
- **One email per person.** Nobody is CC'd or BCC'd together. Each candidate gets
  their own message addressed to them.
- **Personalisation.** `{{name}}`, `{{firstname}}`, `{{email}}`, `{{deadline}}`
  and `{{role}}` are substituted per recipient.
- **AI drafting.** Describe the assignment in a sentence and let OpenAI or Claude
  write the subject and body. Optional — leave the key out and write it yourself.
- **Attachments.** Drop in the PDF brief (up to 5 files, 25 MB each).
- **Live progress.** Watch each address succeed or fail as it goes, with a stop
  button and a per-recipient CSV.
- **Searchable history.** Every email ever sent, filterable by candidate, hiring
  domain, status and date — and it survives restarts.

### Tracking by hiring domain

Tag each batch with the role it's for, and the History page breaks it down:

| Domain | People | Sent | Failed |
| --- | ---: | ---: | ---: |
| Flutter Developer | 4 | 3 | 1 |
| Python Developer | 3 | 3 | 0 |
| React Developer | 2 | 1 | 1 |

Click any row to filter everything to it. A second table groups by **email
provider** instead — if Gmail shows `4/6` while everything else is clean, that's
a deliverability problem, not a candidate problem.

---

## Quick start

Requires **Node 20+**.

```bash
git clone https://github.com/kirtika01/Briefcase.git
cd Briefcase
npm install
cp .env.example .env      # then fill it in — see below
npm run check             # verifies your login without sending anything
npm start                 # → http://localhost:3210
```

### Configure `.env`

**Email (required).** For Gmail you need an
[App Password](https://myaccount.google.com/apppasswords) — your normal password
will be rejected, and the page only appears once 2-Step Verification is on.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=abcdefghijklmnop        # 16-char App Password, no spaces
MAIL_FROM_NAME=Your Name
MAIL_FROM_EMAIL=you@gmail.com
```

Outlook, Zoho, SendGrid, Mailgun and college mail servers work the same way.

```bash
npm run set-password      # safer than editing by hand — hidden input, validates length
```

**AI drafting (optional).** Set *one*:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1              # or gpt-4.1-mini for lower cost
# — or —
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
AI_PROVIDER=auto                  # openai | anthropic | auto
```

Leave both blank and the AI panel greys out; everything else still works.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the dashboard |
| `npm run dev` | Same, restarting on file changes |
| `npm run check` | Verify email login + AI key **without sending anything** |
| `npm run set-password` | Set the SMTP password safely (hidden input) |

---

## How it works

```
public/          dashboard — plain HTML/CSS/JS, no build step
server.js        routes, uploads, live progress stream
src/config.js    reads .env
src/recipients.js  turns pasted text or CSV into a clean recipient list
src/mailer.js    SMTP transport, message building, readable error messages
src/ai.js        draft generation (OpenAI or Claude)
src/jobs.js      send queue, throttling, retries, progress
src/history.js   durable JSONL history + search
scripts/         check.js, set-password.js
```

Sending is deliberately throttled — 3 at a time with a 400 ms gap — so providers
don't rate-limit you. Failures retry twice, then land in the CSV with the actual
SMTP error. The login is verified once up front, so a bad password fails
immediately instead of once per recipient.

History is appended to `data/history.jsonl`, one JSON object per email. Plain
text on purpose: you can `grep` it or open it in a spreadsheet.

---

## Things worth knowing

- **Provider limits apply.** Gmail personal accounts cap around 500
  recipients/day, Workspace around 2,000. Beyond that use SendGrid, Mailgun or
  SES — same SMTP settings, no code changes.
- **Uploaded files are deleted** as soon as a run finishes.
- **Restarting clears live job reports** (history survives) — download the CSV if
  you want the per-run detail.
- **Single instance only.** Job state lives in memory; running two copies would
  split it.

## Security

- `.env`, `.env.backup`, `data/` and `uploads/` are git-ignored. **Never commit
  them** — they hold your mail password and candidate addresses.
- Built for `localhost`. Before exposing it anywhere, set `DASHBOARD_PASSWORD`
  in `.env` and put it behind HTTPS — anyone who can open the page can send email
  as you and read every address in your history.
- **Not deployable to Vercel/Netlify as-is** — serverless functions time out
  mid-send and have no persistent disk for history. Use a host that runs a real
  Node process: Render, Railway or Fly.io.

## Licence

MIT
