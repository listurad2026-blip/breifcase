// `npm run check` — verifies your .env without sending a single email.
// Secrets are never printed, only their length and first/last few characters.

import { config, capabilities, activeAiProvider } from '../src/config.js';
import { verifyConnection } from '../src/mailer.js';
import { draftEmail } from '../src/ai.js';

const PLACEHOLDERS = [
  'you@gmail.com',
  'your-16-char-app-password',
  'your-api-key',
  'sk-...',
];

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

const mask = (v) => (v ? `${v.slice(0, 3)}…${v.slice(-3)} (${v.length} chars)` : 'empty');
const isPlaceholder = (v) => PLACEHOLDERS.includes(String(v ?? '').trim());

let blockers = 0;

console.log('\n\x1b[1mChecking your setup\x1b[0m\n');

/* ------------------------------------------------------------------ SMTP -- */
console.log('\x1b[1mEmail sending (required)\x1b[0m');

const { host, user, pass } = config.smtp;
if (!host || !user || !pass) {
  bad('SMTP_HOST / SMTP_USER / SMTP_PASS are not all filled in.');
  blockers += 1;
} else if (isPlaceholder(user) || isPlaceholder(pass)) {
  const stale = [
    isPlaceholder(user) ? 'SMTP_USER' : null,
    isPlaceholder(pass) ? 'SMTP_PASS' : null,
  ].filter(Boolean);
  bad(
    `${stale.join(' and ')} still ${stale.length > 1 ? 'hold' : 'holds'} ` +
      `the example value from .env.example.`,
  );
  if (stale.includes('SMTP_PASS')) {
    warn('Generate a Gmail App Password at https://myaccount.google.com/apppasswords');
  }
  blockers += 1;
} else {
  ok(`Credentials present — ${user} @ ${host}:${config.smtp.port} (password ${mask(pass)})`);
  try {
    await verifyConnection();
    ok('Server accepted the login. Sending will work.');
  } catch (error) {
    bad(`Server rejected the connection: ${error.message}`);
    if (/invalid login|username and password/i.test(error.message)) {
      warn('For Gmail this must be an App Password, not your normal password.');
    }
    blockers += 1;
  }
}

if (isPlaceholder(config.from.email)) {
  warn(`MAIL_FROM_EMAIL is still "${config.from.email}" — recipients would see that.`);
}

/* -------------------------------------------------------------------- AI -- */
console.log('\n\x1b[1mAI drafting (optional)\x1b[0m');

const provider = activeAiProvider();
if (!provider) {
  const hasEither = config.ai.openaiApiKey || config.ai.anthropicApiKey;
  warn(
    hasEither
      ? `A key is present but AI_PROVIDER=${config.ai.provider} points at the other one.`
      : 'No key set — the "Draft it with AI" box will be greyed out. Everything else works.',
  );
} else {
  const key = provider === 'openai' ? config.ai.openaiApiKey : config.ai.anthropicApiKey;
  const model = provider === 'openai' ? config.ai.openaiModel : config.ai.anthropicModel;
  ok(`Using ${provider} · ${model} (key ${mask(key)})`);
  try {
    const draft = await draftEmail({
      instructions: 'A one-line test. Reply with a very short placeholder email.',
      deadline: 'tomorrow',
      tone: 'short and direct',
      hasAttachment: false,
    });
    ok(`Live call succeeded — got subject: "${draft.subject}"`);
  } catch (error) {
    bad(error.message);
    if (/model|does not exist|not found/i.test(error.message)) {
      warn(`Try a different OPENAI_MODEL — gpt-4o-mini and gpt-4o are the usual choices.`);
    }
    warn('This only disables the AI button; you can still write emails yourself.');
  }
}

/* ---------------------------------------------------------------- server -- */
console.log('\n\x1b[1mServer\x1b[0m');
const caps = capabilities();
ok(`Port ${config.port} · ${caps.concurrency} emails at a time · ${caps.delayMs}ms apart`);
if (config.dashboardPassword) ok('Dashboard is password protected.');

console.log(
  blockers === 0
    ? '\n\x1b[32mReady to go.\x1b[0m Run `npm start` and open the dashboard.\n'
    : `\n\x1b[31m${blockers} thing(s) still to fix\x1b[0m before you can send. See above.\n`,
);
process.exit(blockers === 0 ? 0 : 1);
