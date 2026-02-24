#!/usr/bin/env node
/**
 * Vault Secrets Script
 *
 * This script reads your .env file and stores all secrets in AWS Secrets Manager.
 * Run this once to migrate your secrets to AWS, then you can remove .env from EC2.
 *
 * Prerequisites:
 * 1. AWS CLI configured with credentials (or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)
 * 2. .env file with your secrets
 *
 * Usage:
 *   node scripts/vault-secrets.js
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// Load .env
config({ path: join(ROOT_DIR, '.env') });

const SECRET_NAME = 'fufu/production';
const REGION = process.env.AWS_REGION || 'us-east-1';

// All the secrets we want to store
const SECRETS_TO_VAULT = [
  // Slack
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',

  // Anthropic
  'ANTHROPIC_API_KEY',

  // Novu
  'NOVU_API_KEY',
  'NOVU_SECRET_KEY',

  // Supabase
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',

  // Database
  'DATABASE_URL',

  // OpenAI (if used)
  'OPENAI_API_KEY',

  // Stripe
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',

  // Resend (email)
  'RESEND_API_KEY',

  // Cloudflare
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',

  // Vercel
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',

  // GitHub
  'GITHUB_TOKEN',

  // Sentry
  'SENTRY_DSN',

  // Add more as needed
];

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║           Fufu Secrets Vault Script              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Check AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('ERROR: AWS credentials not found.');
    console.error('');
    console.error('Please set these environment variables:');
    console.error('  export AWS_ACCESS_KEY_ID=your-access-key');
    console.error('  export AWS_SECRET_ACCESS_KEY=your-secret-key');
    console.error('  export AWS_REGION=us-east-1  # optional');
    console.error('');
    console.error('Or configure AWS CLI:');
    console.error('  aws configure');
    console.error('');
    process.exit(1);
  }

  const client = new SecretsManagerClient({ region: REGION });

  // Collect secrets from environment
  const secrets = {};
  let found = 0;
  let missing = 0;

  console.log('Scanning for secrets in .env...\n');

  for (const key of SECRETS_TO_VAULT) {
    const value = process.env[key];
    if (value) {
      secrets[key] = value;
      console.log(`  ✓ ${key}`);
      found++;
    } else {
      console.log(`  ○ ${key} (not set)`);
      missing++;
    }
  }

  console.log('');
  console.log(`Found: ${found} secrets`);
  console.log(`Missing: ${missing} secrets`);
  console.log('');

  if (found === 0) {
    console.error('No secrets found! Make sure your .env file is populated.');
    process.exit(1);
  }

  // Check if secret exists
  let secretExists = false;
  try {
    await client.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
    secretExists = true;
    console.log(`Secret "${SECRET_NAME}" already exists. Updating...`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`Creating new secret "${SECRET_NAME}"...`);
    } else {
      throw err;
    }
  }

  // Store secrets
  const secretString = JSON.stringify(secrets, null, 2);

  if (secretExists) {
    await client.send(new UpdateSecretCommand({
      SecretId: SECRET_NAME,
      SecretString: secretString,
    }));
  } else {
    await client.send(new CreateSecretCommand({
      Name: SECRET_NAME,
      SecretString: secretString,
      Description: 'Fufu Claude Code Slack Bot - Production secrets',
      Tags: [
        { Key: 'Project', Value: 'Fufu' },
        { Key: 'Environment', Value: 'production' },
      ],
    }));
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║                    SUCCESS!                       ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Secrets stored in AWS Secrets Manager: ${SECRET_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. On EC2, ensure AWS credentials are set or use IAM role');
  console.log('2. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env');
  console.log('3. Remove sensitive values from .env (keep only AWS creds)');
  console.log('4. Fufu will automatically load secrets from AWS');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
