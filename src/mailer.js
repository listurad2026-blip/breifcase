import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter = null;

export function getTransporter() {
  if (transporter) return transporter;
  const { host, port, secure, user, pass } = config.smtp;
  if (!host || !user || !pass) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in your .env file.',
    );
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: config.sending.concurrency,
    maxMessages: 100,
  });
  return transporter;
}

/** Used by the "Test connection" button so users find auth problems early. */
export async function verifyConnection() {
  await getTransporter().verify();
  return true;
}

export function fromHeader() {
  const { name, email } = config.from;
  if (!email) throw new Error('MAIL_FROM_EMAIL (or SMTP_USER) is not set.');
  return name ? `"${name.replace(/"/g, "'")}" <${email}>` : email;
}

/** Minimal, safe text -> HTML so line breaks and links survive in the inbox. */
export function textToHtml(text) {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb">$1</a>',
  );
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap">${linked}</div>`;
}

/**
 * SMTP errors are famously cryptic. Translate the ones people actually hit into
 * a sentence that says what to do about it.
 */
export function explainSmtpError(error) {
  const raw = error?.message || String(error);

  if (/535|BadCredentials|Username and Password not accepted/i.test(raw)) {
    return (
      'Gmail rejected the login. Use a 16-character App Password ' +
      '(myaccount.google.com/apppasswords) generated while signed in as ' +
      `${config.smtp.user} — a normal account password will not work here.`
    );
  }
  if (/534|Application-specific password required/i.test(raw)) {
    return 'Gmail requires an App Password on this account. Turn on 2-Step Verification, then generate one.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return `Could not reach ${config.smtp.host}. Check the SMTP_HOST spelling and your internet connection.`;
  }
  if (/ECONNREFUSED|ETIMEDOUT|ESOCKET|Connection timeout/i.test(raw)) {
    return `${config.smtp.host}:${config.smtp.port} did not respond. Check SMTP_PORT and SMTP_SECURE (465 = true, 587 = false).`;
  }
  if (/Daily user sending (limit|quota) exceeded|550-5\.4\.5/i.test(raw)) {
    return 'Gmail daily sending limit reached (~500/day on personal accounts). Continue tomorrow or use a bulk provider.';
  }
  if (/Message rejected|spam|550-5\.7\.1/i.test(raw)) {
    return `The server rejected the message as spam-like: ${raw}`;
  }
  if (/550|551|553|Recipient address rejected|does not exist/i.test(raw)) {
    return `The recipient address was rejected by the server: ${raw}`;
  }
  return raw;
}

export async function sendOne({ to, subject, text, attachments }) {
  const info = await getTransporter().sendMail({
    from: fromHeader(),
    replyTo: config.from.replyTo || undefined,
    to,
    subject,
    text,
    html: textToHtml(text),
    attachments,
  });
  return info.messageId;
}
