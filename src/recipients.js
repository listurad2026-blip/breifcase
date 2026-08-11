// Turns whatever the user pasted (or uploaded) into a clean recipient list.

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
/** Matches `Priya Sharma <priya@x.com>` anywhere in a line. */
const ANGLED_RE = /([^,;<>\t]*?)\s*<\s*([^\s<>]+@[^\s<>]+)\s*>/g;
/** Spreadsheet header cells we should quietly ignore rather than treat as a name. */
const HEADER_RE = /^(name|full ?name|first ?name|last ?name|student|email|e-?mail|address|sr\.?|s\.?no\.?|#)$/i;

/** Only complain about things the user plainly *meant* to be an address. */
function looksLikeAnAttempt(token) {
  return token.includes('@') || /^[\w.+-]+\.[a-z]{2,}$/i.test(token);
}

/** Derive a usable first name from the local part when none was supplied. */
function nameFromEmail(email) {
  const local = email.split('@')[0].replace(/[._\-+]+/g, ' ').trim();
  if (!local) return '';
  return local
    .split(/\s+/)
    .filter((w) => !/^\d+$/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Accepts free text (commas, semicolons, spaces, newlines) *or* CSV/TSV pasted
 * straight out of a spreadsheet. Returns deduplicated recipients plus whatever
 * could not be understood, so the UI can show the user exactly what it dropped.
 */
export function parseRecipients(raw) {
  const text = String(raw ?? '');
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();

  const add = (name, email) => {
    const clean = email.trim().replace(/^mailto:/i, '').replace(/^["'<]+|["'>.,;]+$/g, '');
    if (!clean) return;
    if (!EMAIL_RE.test(clean)) {
      if (looksLikeAnAttempt(clean)) invalid.push(clean);
      return;
    }
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(clean);
      return;
    }
    seen.add(key);
    const label = name?.trim().replace(/^["']|["']$/g, '') ?? '';
    valid.push({ email: clean, name: HEADER_RE.test(label) ? nameFromEmail(clean) : label || nameFromEmail(clean) });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    // 1. Pull out every `Name <address>` first, so the display name stays glued
    //    to its address no matter what else shares the line.
    let line = rawLine;
    for (const match of rawLine.matchAll(ANGLED_RE)) add(match[1], match[2]);
    line = rawLine.replace(ANGLED_RE, ' ');
    if (!line.trim()) continue;

    // 2. Spreadsheet-style row: one address cell plus a name cell beside it.
    const cells = line.split(/[\t,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const emailCells = cells.filter((c) => EMAIL_RE.test(c));
    if (cells.length > 1 && emailCells.length === 1) {
      const nameCell = cells.find((c) => c && c !== emailCells[0] && !EMAIL_RE.test(c)) || '';
      add(nameCell, emailCells[0]);
      continue;
    }

    // 3. Otherwise treat every whitespace/punctuation-separated token as a
    //    candidate address and let `add` filter out the prose.
    for (const token of line.split(/[,;\t\s]+/)) {
      if (token.trim()) add('', token);
    }
  }

  return { valid, invalid, duplicates };
}

/** Fill {{name}} / {{email}} / {{deadline}} style placeholders. */
export function applyPlaceholders(template, recipient, extras = {}) {
  const values = {
    name: recipient.name || recipient.email,
    email: recipient.email,
    firstname: (recipient.name || nameFromEmail(recipient.email)).split(/\s+/)[0] || '',
    ...extras,
  };
  return String(template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = values[key.toLowerCase()];
    return value === undefined || value === null ? match : String(value);
  });
}
