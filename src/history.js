// Durable send history: one JSON line per recipient, appended as mail goes out.
// Kept as plain JSONL so it survives restarts, stays greppable outside the app,
// and needs no database. The whole file is held in memory for instant search —
// a few hundred thousand rows is comfortably fine.
//
// Two different groupings are tracked, and they are easy to confuse:
//   role        — the hiring domain you typed, e.g. "Flutter", "Python"
//   emailDomain — the part after the @, e.g. "gmail.com"

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'history.jsonl');

export const NO_ROLE = '(none)';

let records = [];
/** Serialises appends so concurrent sends can't interleave a half-written line. */
let writeChain = Promise.resolve();

export function loadHistory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    records = [];
    return 0;
  }
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  records = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      // Tolerate rows written before roles existed.
      parsed.role ||= NO_ROLE;
      parsed.emailDomain ||= emailDomainOf(parsed.email);
      records.push(parsed);
    } catch {
      skipped += 1; // a truncated final line from an unclean shutdown
    }
  }
  if (skipped) console.warn(`  history: skipped ${skipped} unreadable line(s)`);
  return records.length;
}

export function emailDomainOf(email) {
  return String(email).split('@')[1]?.toLowerCase() ?? '(unknown)';
}

/** Roles are matched case-insensitively but displayed as first typed. */
export function normaliseRole(role) {
  return String(role ?? '').trim().replace(/\s+/g, ' ') || NO_ROLE;
}

/** Records one recipient outcome. Never throws — history must not break a send. */
export function recordSend(entry) {
  const record = {
    id: randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    jobId: entry.jobId ?? null,
    source: entry.source ?? 'campaign', // 'campaign' | 'test'
    role: normaliseRole(entry.role),
    email: entry.email,
    name: entry.name ?? '',
    emailDomain: emailDomainOf(entry.email),
    status: entry.status, // 'sent' | 'failed'
    error: entry.error ?? '',
    attempts: entry.attempts ?? 1,
    messageId: entry.messageId ?? '',
    subject: entry.subject ?? '',
    attachments: entry.attachments ?? [],
  };
  records.push(record);
  writeChain = writeChain
    .then(() => fsp.appendFile(FILE, `${JSON.stringify(record)}\n`))
    .catch((error) => console.error('  history: could not write entry —', error.message));
  return record;
}

/** Waits for pending writes — used by tests and graceful shutdown. */
export function flushHistory() {
  return writeChain;
}

const contains = (haystack, needle) => String(haystack ?? '').toLowerCase().includes(needle);

/**
 * Free-text search across address, name, subject and role, plus optional facet
 * filters. Returns newest-first and paginated, along with the groupings for the
 * *matched* set so the tables reflect what you're looking at.
 */
export function searchHistory({
  q = '',
  status = 'all',
  role = '',
  emailDomain = '',
  source = 'all',
  from = '',
  to = '',
  page = 1,
  pageSize = 50,
} = {}) {
  const needle = q.trim().toLowerCase();
  const wantRole = role.trim().toLowerCase();
  const wantDomain = emailDomain.trim().toLowerCase();
  const fromTime = from ? Date.parse(from) : null;
  // An end date with no time means "the whole of that day".
  const toTime = to ? Date.parse(/T/.test(to) ? to : `${to}T23:59:59.999`) : null;

  const matched = records.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (source !== 'all' && r.source !== source) return false;
    if (wantRole && r.role.toLowerCase() !== wantRole) return false;
    if (wantDomain && r.emailDomain !== wantDomain) return false;
    if (fromTime && Date.parse(r.at) < fromTime) return false;
    if (toTime && Date.parse(r.at) > toTime) return false;
    if (needle) {
      return (
        contains(r.email, needle) ||
        contains(r.name, needle) ||
        contains(r.subject, needle) ||
        contains(r.role, needle)
      );
    }
    return true;
  });

  matched.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const size = Math.min(Math.max(1, Number(pageSize) || 50), 500);
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * size;

  return {
    rows: matched.slice(start, start + size),
    page: current,
    pages,
    pageSize: size,
    total: matched.length,
    stats: summarise(matched),
    roles: groupBy(matched, (r) => r.role),
    emailDomains: groupBy(matched, (r) => r.emailDomain),
    all: matched,
  };
}

function summarise(rows) {
  let sent = 0;
  let failed = 0;
  const people = new Set();
  const roles = new Set();
  for (const r of rows) {
    if (r.status === 'sent') sent += 1;
    else failed += 1;
    people.add(r.email.toLowerCase());
    roles.add(r.role);
  }
  return {
    total: rows.length,
    sent,
    failed,
    uniqueRecipients: people.size,
    uniqueRoles: roles.size,
    firstAt: rows.length ? rows[rows.length - 1].at : null,
    lastAt: rows.length ? rows[0].at : null,
  };
}

/** Groups rows by any key function into {key, total, sent, failed, recipients}. */
function groupBy(rows, keyOf) {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    const entry = map.get(key) ?? {
      key,
      total: 0,
      sent: 0,
      failed: 0,
      recipients: new Set(),
      lastAt: null,
    };
    entry.total += 1;
    if (r.status === 'sent') entry.sent += 1;
    else entry.failed += 1;
    entry.recipients.add(r.email.toLowerCase());
    if (!entry.lastAt || r.at > entry.lastAt) entry.lastAt = r.at;
    map.set(key, entry);
  }
  return [...map.values()]
    .map(({ recipients, ...rest }) => ({ ...rest, recipients: recipients.size }))
    .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

/** Every role ever used — powers the filter dropdown and compose autocomplete. */
export function allRoles() {
  return groupBy(records, (r) => r.role)
    .map((entry) => entry.key)
    .filter((role) => role !== NO_ROLE);
}

export function allEmailDomains() {
  return groupBy(records, (r) => r.emailDomain).map((entry) => entry.key);
}

export function historyToCsv(rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header =
    'sent_at,role,email,name,email_domain,status,subject,attempts,source,attachments,message_id,error';
  const lines = rows.map((r) =>
    [
      r.at,
      r.role,
      r.email,
      r.name,
      r.emailDomain,
      r.status,
      r.subject,
      r.attempts,
      r.source,
      (r.attachments || []).join(' | '),
      r.messageId,
      r.error,
    ]
      .map(escape)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function historyCount() {
  return records.length;
}
