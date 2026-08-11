import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { config, capabilities } from './src/config.js';
import { parseRecipients, applyPlaceholders } from './src/recipients.js';
import { verifyConnection, sendOne, explainSmtpError } from './src/mailer.js';
import { draftEmail } from './src/ai.js';
import { startJob, getJob, subscribe, cancelJob, summarize, resultsAsCsv } from './src/jobs.js';
import {
  loadHistory,
  recordSend,
  searchHistory,
  allRoles,
  allEmailDomains,
  historyToCsv,
  historyCount,
} from './src/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const MAX_RECIPIENTS = 5000;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
});

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- optional password gate ------------------------------------------------
app.use('/api', (req, res, next) => {
  if (!config.dashboardPassword) return next();
  if (req.path === '/config') return next();
  const supplied = req.get('x-dashboard-password') || req.query.key;
  if (supplied === config.dashboardPassword) return next();
  res.status(401).json({ error: 'Wrong dashboard password.' });
});

const fail = (res, error, status = 400) =>
  res.status(status).json({ error: error instanceof Error ? error.message : String(error) });

// --- what the UI is allowed to offer --------------------------------------
app.get('/api/config', (_req, res) => {
  res.json({ ...capabilities(), passwordRequired: Boolean(config.dashboardPassword) });
});

// --- recipient parsing + live preview -------------------------------------
app.post('/api/preview', (req, res) => {
  try {
    const { recipients: raw, subject = '', body = '', deadline = '', role = '' } = req.body ?? {};
    const parsed = parseRecipients(raw);
    const sample = parsed.valid[0];
    res.json({
      counts: {
        valid: parsed.valid.length,
        invalid: parsed.invalid.length,
        duplicates: parsed.duplicates.length,
      },
      invalid: parsed.invalid.slice(0, 25),
      sampleEmails: parsed.valid.slice(0, 8).map((r) => r.email),
      preview: sample
        ? {
            to: sample.email,
            subject: applyPlaceholders(subject, sample, { deadline, role }),
            body: applyPlaceholders(body, sample, { deadline, role }),
          }
        : null,
    });
  } catch (error) {
    fail(res, error);
  }
});

// --- SMTP connection check -------------------------------------------------
app.post('/api/smtp/test', async (_req, res) => {
  try {
    await verifyConnection();
    res.json({ ok: true, message: `Connected to ${config.smtp.host} as ${config.smtp.user}.` });
  } catch (error) {
    fail(res, new Error(explainSmtpError(error)));
  }
});

// --- AI drafting -----------------------------------------------------------
app.post('/api/ai/draft', async (req, res) => {
  try {
    const { instructions = '', deadline = '', tone = '', hasAttachment = false, existingBody = '' } =
      req.body ?? {};
    if (!instructions.trim()) {
      return fail(res, new Error('Tell the AI what the email should say first.'));
    }
    const draft = await draftEmail({ instructions, deadline, tone, hasAttachment, existingBody });
    res.json(draft);
  } catch (error) {
    fail(res, error, 500);
  }
});

// --- send ------------------------------------------------------------------
app.post('/api/send', upload.array('attachments', 5), async (req, res) => {
  const files = req.files ?? [];
  const cleanup = () => Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));

  try {
    const { recipients: raw = '', subject = '', body = '', deadline = '', role = '' } =
      req.body ?? {};

    if (!subject.trim()) throw new Error('Subject is required.');
    if (!body.trim()) throw new Error('Message body is required.');

    const parsed = parseRecipients(raw);
    if (parsed.valid.length === 0) throw new Error('No valid email addresses found.');
    if (parsed.valid.length > MAX_RECIPIENTS) {
      throw new Error(`That is ${parsed.valid.length} recipients — the limit is ${MAX_RECIPIENTS}.`);
    }

    // Check the login once up front — otherwise a bad password means every
    // single recipient fails individually with the same unhelpful error.
    try {
      await verifyConnection();
    } catch (error) {
      throw new Error(explainSmtpError(error));
    }

    const attachments = files.map((f) => ({
      filename: f.originalname,
      path: f.path,
      contentType: f.mimetype,
    }));

    const job = startJob({
      recipients: parsed.valid,
      subject: subject.trim(),
      body,
      deadline,
      role,
      attachments,
    });

    // Hold the uploaded files on disk until the last email has gone out.
    subscribe(job.id, (event) => {
      if (event.type === 'done' || event.type === 'error') cleanup();
    });

    res.json({ jobId: job.id, total: job.total, skipped: parsed.invalid.length });
  } catch (error) {
    await cleanup();
    fail(res, error);
  }
});

// --- one-off test email to yourself ---------------------------------------
app.post('/api/send/test', upload.array('attachments', 5), async (req, res) => {
  const files = req.files ?? [];
  try {
    const { to = '', subject = '', body = '', deadline = '', role = '' } = req.body ?? {};
    const parsed = parseRecipients(to);
    if (parsed.valid.length !== 1) throw new Error('Enter exactly one valid test address.');
    if (!subject.trim() || !body.trim()) throw new Error('Subject and body are required.');

    const recipient = parsed.valid[0];
    const extras = { deadline, role };
    const personalSubject = applyPlaceholders(subject, recipient, extras);
    const attachmentNames = files.map((f) => f.originalname);
    try {
      const messageId = await sendOne({
        to: recipient.email,
        subject: personalSubject,
        text: applyPlaceholders(body, recipient, extras),
        attachments: files.map((f) => ({
          filename: f.originalname,
          path: f.path,
          contentType: f.mimetype,
        })),
      });
      recordSend({
        email: recipient.email,
        name: recipient.name,
        status: 'sent',
        messageId,
        subject: personalSubject,
        attachments: attachmentNames,
        source: 'test',
        role,
      });
    } catch (error) {
      recordSend({
        email: recipient.email,
        name: recipient.name,
        status: 'failed',
        error: explainSmtpError(error),
        subject: personalSubject,
        attachments: attachmentNames,
        source: 'test',
        role,
      });
      throw error;
    }
    res.json({ ok: true, message: `Test email sent to ${recipient.email}.` });
  } catch (error) {
    fail(res, new Error(explainSmtpError(error)), 500);
  } finally {
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));
  }
});

// --- searchable send history ----------------------------------------------
app.get('/api/history', (req, res) => {
  try {
    const { all, ...result } = searchHistory(req.query);
    res.json({ ...result, availableRoles: allRoles(), availableEmailDomains: allEmailDomains() });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/history/export.csv', (req, res) => {
  const { all } = searchHistory({ ...req.query, page: 1, pageSize: 500 });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="email-history-${stamp}.csv"`);
  res.send(historyToCsv(all));
});

// --- live progress (Server-Sent Events) -----------------------------------
app.get('/api/jobs/:id/stream', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, new Error('Unknown job.'), 404);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const unsubscribe = subscribe(req.params.id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, new Error('Unknown job.'), 404);
  res.json(summarize(job));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const stopped = cancelJob(req.params.id);
  res.json({ ok: stopped });
});

app.get('/api/jobs/:id/results.csv', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, new Error('Unknown job.'), 404);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="send-results-${job.id}.csv"`);
  res.send(resultsAsCsv(job));
});

// `no-cache` still lets the browser cache, but forces a revalidation request
// every load — so an updated dashboard is picked up without a hard refresh,
// while unchanged files cost only a 304.
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

// Multer and everything else land here with a readable message.
app.use((error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return fail(res, new Error('Attachment is larger than the 25 MB limit.'), 413);
  }
  fail(res, error, 500);
});

const historyRows = loadHistory();

app.listen(config.port, () => {
  const caps = capabilities();
  console.log(`\n  💼 Briefcase  →  http://localhost:${config.port}\n`);
  console.log(`  SMTP : ${caps.smtpConfigured ? `ready (${config.smtp.host})` : 'NOT configured — edit .env'}`);
  console.log(
    `  AI   : ${caps.aiConfigured ? `${caps.aiProvider} · ${caps.aiModel}` : 'off (no OPENAI_API_KEY / ANTHROPIC_API_KEY)'}`,
  );
  console.log(`  From : ${caps.fromEmail || '—'}`);
  console.log(`  Sent : ${historyRows} email(s) in history\n`);
});
