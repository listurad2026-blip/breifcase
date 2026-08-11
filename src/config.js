import 'dotenv/config';

const num = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 3210),
  dashboardPassword: process.env.DASHBOARD_PASSWORD?.trim() || '',

  smtp: {
    host: process.env.SMTP_HOST?.trim() || '',
    port: num(process.env.SMTP_PORT, 465),
    secure: (process.env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false',
    user: process.env.SMTP_USER?.trim() || '',
    pass: process.env.SMTP_PASS ?? '',
  },

  from: {
    name: process.env.MAIL_FROM_NAME?.trim() || '',
    email: process.env.MAIL_FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim() || '',
    replyTo: process.env.MAIL_REPLY_TO?.trim() || '',
  },

  sending: {
    concurrency: Math.max(1, num(process.env.SEND_CONCURRENCY, 3)),
    delayMs: Math.max(0, num(process.env.SEND_DELAY_MS, 400)),
    maxRetries: Math.max(0, num(process.env.SEND_MAX_RETRIES, 2)),
  },

  ai: {
    // 'auto' picks whichever key is present (OpenAI wins if you set both).
    provider: (process.env.AI_PROVIDER?.trim() || 'auto').toLowerCase(),
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
    openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
  },
};

/** Which AI service the drafting button will actually call, if any. */
export function activeAiProvider() {
  const { provider, openaiApiKey, anthropicApiKey } = config.ai;
  if (provider === 'openai') return openaiApiKey ? 'openai' : null;
  if (provider === 'anthropic') return anthropicApiKey ? 'anthropic' : null;
  if (openaiApiKey) return 'openai';
  if (anthropicApiKey) return 'anthropic';
  return null;
}

/** Which optional features are wired up — the UI greys out the rest. */
export function capabilities() {
  const provider = activeAiProvider();
  return {
    smtpConfigured: Boolean(config.smtp.host && config.smtp.user && config.smtp.pass),
    aiConfigured: Boolean(provider),
    aiProvider: provider,
    aiModel:
      provider === 'openai'
        ? config.ai.openaiModel
        : provider === 'anthropic'
          ? config.ai.anthropicModel
          : null,
    fromEmail: config.from.email,
    fromName: config.from.name,
    concurrency: config.sending.concurrency,
    delayMs: config.sending.delayMs,
  };
}
