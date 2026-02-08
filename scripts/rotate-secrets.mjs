#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function needEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} env var is required.`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_PROJECT_REF = needEnv('SUPABASE_PROJECT_REF');

const INTERNAL_SYNC_SECRET_NEW = randomBytes(32).toString('hex');
const SUPABASE_WEBHOOK_SECRET_NEW = randomBytes(32).toString('hex');

const skipSquare = process.argv.includes('--skip-square');
let SQUARE_WEBHOOK_SIGNATURE_NEW = process.env.SQUARE_WEBHOOK_SIGNATURE_NEW || '';

async function promptForSquareSignature() {
  if (skipSquare) return;
  if (SQUARE_WEBHOOK_SIGNATURE_NEW) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  SQUARE_WEBHOOK_SIGNATURE_NEW = await new Promise((resolve) => {
    rl.question('Enter NEW SQUARE_WEBHOOK_SIGNATURE (from Square dashboard): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
  if (!SQUARE_WEBHOOK_SIGNATURE_NEW) {
    console.error('ERROR: SQUARE_WEBHOOK_SIGNATURE_NEW cannot be empty.');
    process.exit(1);
  }
}

await promptForSquareSignature();

console.log('Updating Netlify environment variables...');
run('netlify', ['env:set', 'INTERNAL_SYNC_SECRET', INTERNAL_SYNC_SECRET_NEW]);
run('netlify', ['env:set', 'SUPABASE_WEBHOOK_SECRET', SUPABASE_WEBHOOK_SECRET_NEW]);
if (!skipSquare) {
  run('netlify', ['env:set', 'SQUARE_WEBHOOK_SIGNATURE', SQUARE_WEBHOOK_SIGNATURE_NEW]);
} else {
  console.log('Skipping SQUARE_WEBHOOK_SIGNATURE rotation.');
}

console.log('Updating Supabase secrets for Edge Functions...');
run('supabase', [
  'secrets', 'set',
  '--project-ref', SUPABASE_PROJECT_REF,
  `INTERNAL_SYNC_SECRET=${INTERNAL_SYNC_SECRET_NEW}`,
  `SUPABASE_WEBHOOK_SECRET=${SUPABASE_WEBHOOK_SECRET_NEW}`
]);

console.log('Triggering Netlify redeploy to flush cached secrets...');
run('netlify', ['deploy', '--prod', '--message', 'Rotate secrets', '--build']);

console.log('Redeploying Supabase Edge Functions to flush secrets...');
run('supabase', ['functions', 'deploy', '--project-ref', SUPABASE_PROJECT_REF]);

console.log('Done. New secrets have been applied.');
