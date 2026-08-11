import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config, activeAiProvider } from './config.js';

let openaiClient = null;
let anthropicClient = null;

/** The shape both providers are forced to return, so the UI gets the same object. */
const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      description: 'Email subject line. Specific and scannable, under 80 characters.',
    },
    body: {
      type: 'string',
      description:
        'Plain-text email body with real line breaks. No markdown syntax, no ** bold **, ' +
        'no subject line repeated inside it.',
    },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You draft assignment emails that an instructor sends to a group of students.

Rules for the body you write:
- Plain text only. Real line breaks, no markdown, no asterisks, no headings.
- Open with a greeting that uses the {{name}} placeholder, e.g. "Hi {{name}},".
- State the assignment, what is expected, and the deadline in clear, direct language.
- If a PDF is attached, refer to it naturally ("The brief is attached as a PDF").
- Close with a sign-off line. Do not invent a signature name unless one was given.
- Keep it to what a student actually needs. No filler, no restating the same point.

Placeholders you may use, exactly as written: {{name}}, {{firstname}}, {{email}}, {{deadline}}.
They are substituted per recipient at send time, so never write a specific student's name.`;

function buildRequest({ instructions, deadline, tone, hasAttachment, existingBody }) {
  const parts = [`What this email needs to say:\n${instructions}`];
  if (deadline) parts.push(`Deadline: ${deadline}`);
  if (tone) parts.push(`Tone: ${tone}`);
  parts.push(hasAttachment ? 'A PDF is attached to this email.' : 'There is no attachment.');
  if (existingBody?.trim()) {
    parts.push(`Rewrite and improve this existing draft rather than starting over:\n${existingBody}`);
  }
  return parts.join('\n\n');
}

function parseDraft(text) {
  if (!text?.trim()) throw new Error('The model returned an empty response. Try again.');
  let draft;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error('The model did not return valid JSON. Try again.');
  }
  if (!draft.subject || !draft.body) {
    throw new Error('The model left out the subject or body. Try again.');
  }
  return { subject: String(draft.subject), body: String(draft.body) };
}

/* ---------------------------------------------------------------- OpenAI -- */

async function draftWithOpenAI(userMessage) {
  openaiClient ??= new OpenAI({ apiKey: config.ai.openaiApiKey });

  let completion;
  try {
    completion = await openaiClient.chat.completions.create({
      model: config.ai.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'assignment_email', strict: true, schema: EMAIL_SCHEMA },
      },
    });
  } catch (error) {
    // The most common setup mistake is picking a model the key can't use, or an
    // older one that has no structured-output support — say so plainly.
    const detail = error?.error?.message || error?.message || String(error);
    throw new Error(`OpenAI (${config.ai.openaiModel}) rejected the request: ${detail}`);
  }

  const choice = completion.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`The model declined: ${choice.message.refusal}`);
  }
  return parseDraft(choice?.message?.content);
}

/* ------------------------------------------------------------- Anthropic -- */

async function draftWithAnthropic(userMessage) {
  anthropicClient ??= new Anthropic({ apiKey: config.ai.anthropicApiKey });

  const response = await anthropicClient.messages.create({
    model: config.ai.anthropicModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: EMAIL_SCHEMA },
      effort: 'medium',
    },
    messages: [{ role: 'user', content: userMessage }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to draft this email. Try rewording your instructions.');
  }
  return parseDraft(response.content.find((block) => block.type === 'text')?.text);
}

/* ------------------------------------------------------------------ API -- */

/** Turns the user's rough notes into a subject + body via whichever key is set. */
export async function draftEmail(input) {
  const provider = activeAiProvider();
  if (!provider) {
    throw new Error(
      'AI drafting is off. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to your .env file to enable it.',
    );
  }
  const userMessage = buildRequest(input);
  return provider === 'openai'
    ? draftWithOpenAI(userMessage)
    : draftWithAnthropic(userMessage);
}
