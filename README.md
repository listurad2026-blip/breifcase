# 💼 Briefcase

**Send a take-home assignment to every candidate at once — one personalised email each, with a searchable record of who got what.**

---

## The problem

You're hiring for a Flutter role. You have a PDF brief, forty shortlisted
candidates, and a deadline. Doing this by hand means forty copy-pasted emails,
forty chances to attach the wrong file or address someone by the wrong name, and
no reliable answer a week later when someone asks *"did we actually send it to
Priya?"*

Mailing everyone at once with a bulk BCC solves the tedium and creates a worse
problem: every candidate can see who else you're considering.

Briefcase does it properly — one personal email per candidate, sent individually,
and it remembers all of it.

---

## What it does

### Takes your list however you have it

Paste addresses separated by commas, spaces or new lines. Paste `Name <email>`
pairs. Paste rows straight out of Excel or Google Sheets. Import a CSV.

Duplicates are removed, names are pulled out automatically, and anything it
can't read is shown back to you rather than silently dropped — so a typo becomes
something you fix, not something you discover a week later.

### Writes the email with you

Describe the assignment in a sentence and let AI draft the subject and body,
then edit it however you like. Or skip that entirely and write it yourself.

Each candidate's copy is personalised — their name in the greeting, the deadline,
the role — so nobody receives an email addressed to "Dear Candidate".

### Sends one email per person

Never a shared BCC. Every candidate gets their own message with the brief
attached, and no visibility of anyone else on the list.

Sending is paced so mail providers don't throttle you, failures are retried
automatically, and anything that still won't deliver is reported with the actual
reason — a wrong address, a full mailbox — rather than a silent gap.

### Shows you what's happening

A live progress panel ticks through the list as it goes, marking each address
delivered or failed. You can stop a run partway. When it's done you get a
per-recipient report.

### Remembers everything

Every email ever sent is searchable — by candidate, by subject, by hiring domain,
by status, by date. This is the part that matters a month later.

**Tracking by hiring domain.** Tag each batch with the role it's for, and the
history breaks down accordingly:

| Domain | People | Sent | Failed |
| --- | ---: | ---: | ---: |
| Flutter Developer | 4 | 3 | 1 |
| Python Developer | 3 | 3 | 0 |
| React Developer | 2 | 1 | 1 |

Click any row to filter everything to it. So *"how many people did we send the
Python assignment to, and did they all get it?"* is one click, not an archaeology
expedition through your Sent folder.

A second breakdown groups by email provider instead. If Gmail shows `4/6` while
every other provider is clean, that's a deliverability problem on your side — not
four candidates who ignored you.

---

## In short

| | |
| --- | --- |
| **Paste any list** | Commas, spaces, `Name <email>`, spreadsheet rows, CSV |
| **Personalised** | Name, deadline and role filled in per candidate |
| **AI drafting** | Describe the assignment, get a subject and body |
| **Attachments** | The PDF brief goes to everyone |
| **Private** | One email per person, never a shared BCC |
| **Live progress** | Watch it send; stop it mid-run if you need to |
| **Searchable history** | Every email, filterable by candidate, domain and date |
| **Exports** | Download any view as CSV |

---

## Licence

MIT
