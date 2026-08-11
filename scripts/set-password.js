// `npm run set-password` — prompts for the SMTP password and writes it into
// .env. Input is hidden while you type, spaces are stripped, and the length is
// validated so a mistyped value can't be saved silently.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

function ask(question) {
  return new Promise((resolve) => {
    // A writable that swallows the echoed keystrokes once we start reading.
    const muted = new Writable({
      write(chunk, encoding, done) {
        if (!muted.hide) process.stdout.write(chunk, encoding);
        done();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: process.stdin.isTTY === true,
    });
    rl.question(question, (answer) => {
      rl.close();
      if (muted.hide) process.stdout.write('\n');
      resolve(answer);
    });
    muted.hide = process.stdin.isTTY === true;
  });
}

if (!fs.existsSync(ENV_PATH)) {
  console.error('\nNo .env file found. Run:  cp .env.example .env\n');
  process.exit(1);
}

const raw = await ask('Gmail App Password (hidden, paste it): ');
const password = raw.replace(/\s/g, '');

if (password.length === 0) {
  console.error('\n✗ Nothing entered. Nothing was changed.\n');
  process.exit(1);
}

if (password.length !== 16) {
  console.error(
    `\n✗ Got ${password.length} characters — a Gmail App Password is exactly 16.\n` +
      '  Generate one at https://myaccount.google.com/apppasswords\n' +
      "  (that page only exists once 2-Step Verification is on).\n" +
      '  Nothing was changed.\n',
  );
  process.exit(1);
}

const before = fs.readFileSync(ENV_PATH, 'utf8');
if (!/^\s*SMTP_PASS\s*=.*$/m.test(before)) {
  console.error('\n✗ No SMTP_PASS line found in .env. Nothing was changed.\n');
  process.exit(1);
}

fs.copyFileSync(ENV_PATH, `${ENV_PATH}.backup`);
fs.writeFileSync(ENV_PATH, before.replace(/^(\s*SMTP_PASS\s*=).*$/m, `$1${password}`));

console.log(`\n✓ Saved 16 characters to .env (previous file kept as .env.backup).`);
console.log('  Now run:  npm run check\n');
