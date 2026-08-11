import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { applyPlaceholders } from './recipients.js';
import { sendOne, explainSmtpError } from './mailer.js';
import { recordSend } from './history.js';

/** In-memory job store. Jobs live until the server restarts. */
const jobs = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function getJob(id) {
  return jobs.get(id);
}

function emit(job, event) {
  for (const listener of job.listeners) {
    try {
      listener(event);
    } catch {
      /* a dead SSE connection must never break the send loop */
    }
  }
}

export function subscribe(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) return () => {};
  job.listeners.add(listener);
  // Replay current state so a late subscriber isn't staring at an empty screen.
  listener({ type: 'snapshot', job: summarize(job) });
  return () => job.listeners.delete(listener);
}

export function summarize(job) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    subject: job.subject,
    role: job.role,
    attachments: job.attachments.map((a) => a.filename),
    results: job.results,
    cancelRequested: job.cancelRequested,
  };
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.cancelRequested = true;
  emit(job, { type: 'cancelling' });
  return true;
}

/**
 * Queues one email per recipient and works through them with a small pool of
 * workers. Each recipient is a separate message — nobody sees anyone else's
 * address, and every person gets their own personalised copy.
 */
export function startJob({ recipients, subject, body, deadline, role, attachments }) {
  const job = {
    id: randomUUID(),
    status: 'running',
    total: recipients.length,
    sent: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    subject,
    role,
    attachments,
    results: [],
    listeners: new Set(),
    cancelRequested: false,
  };
  jobs.set(job.id, job);

  run(job, { recipients, subject, body, deadline, role, attachments }).catch((error) => {
    job.status = 'error';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    emit(job, { type: 'error', message: error.message });
  });

  return job;
}

async function run(job, { recipients, subject, body, deadline, role, attachments }) {
  const queue = [...recipients];
  const { concurrency, delayMs, maxRetries } = config.sending;
  const attachmentNames = attachments.map((a) => a.filename);

  const worker = async () => {
    while (queue.length > 0) {
      if (job.cancelRequested) return;
      const recipient = queue.shift();
      if (!recipient) return;

      const extras = { deadline: deadline || '', role: role || '' };
      const personalSubject = applyPlaceholders(subject, recipient, extras);
      const personalBody = applyPlaceholders(body, recipient, extras);

      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const messageId = await sendOne({
            to: recipient.name ? `"${recipient.name.replace(/"/g, "'")}" <${recipient.email}>` : recipient.email,
            subject: personalSubject,
            text: personalBody,
            attachments,
          });
          lastError = null;
          job.sent += 1;
          const result = {
            email: recipient.email,
            name: recipient.name,
            status: 'sent',
            messageId,
            attempts: attempt + 1,
            at: new Date().toISOString(),
          };
          job.results.push(result);
          recordSend({ ...result, jobId: job.id, role, subject: personalSubject, attachments: attachmentNames });
          emit(job, { type: 'progress', result, job: summarize(job) });
          break;
        } catch (error) {
          lastError = error;
          // Back off a little before retrying — most SMTP failures are transient.
          if (attempt < maxRetries) await sleep(500 * (attempt + 1));
        }
      }

      if (lastError) {
        job.failed += 1;
        const result = {
          email: recipient.email,
          name: recipient.name,
          status: 'failed',
          error: explainSmtpError(lastError),
          attempts: maxRetries + 1,
          at: new Date().toISOString(),
        };
        job.results.push(result);
        recordSend({ ...result, jobId: job.id, role, subject: personalSubject, attachments: attachmentNames });
        emit(job, { type: 'progress', result, job: summarize(job) });
      }

      if (delayMs) await sleep(delayMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, recipients.length) }, worker));

  job.status = job.cancelRequested ? 'cancelled' : 'done';
  job.finishedAt = new Date().toISOString();
  emit(job, { type: 'done', job: summarize(job) });
}

export function resultsAsCsv(job) {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = 'email,name,status,attempts,sent_at,message_id,error';
  const rows = job.results.map((r) =>
    [r.email, r.name, r.status, r.attempts, r.at, r.messageId || '', r.error || '']
      .map(escape)
      .join(','),
  );
  return [header, ...rows].join('\n');
}
