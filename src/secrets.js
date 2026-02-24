/**
 * AWS Secrets Manager Integration for Fufu
 *
 * Stores and retrieves all API keys and credentials from AWS Secrets Manager.
 * Falls back to .env if AWS is not configured.
 */

import { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';

const SECRET_NAME = 'fufu/production';
const REGION = process.env.AWS_REGION || 'us-east-1';

let client = null;
let cachedSecrets = null;

/**
 * Initialize the Secrets Manager client
 */
export function initSecretsManager() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('[Secrets] AWS credentials not found, using .env fallback');
    return false;
  }

  client = new SecretsManagerClient({ region: REGION });
  console.log('[Secrets] AWS Secrets Manager initialized');
  return true;
}

/**
 * Get all secrets from AWS Secrets Manager
 * Falls back to process.env if AWS is not configured
 */
export async function getSecrets() {
  // Return cached secrets if available
  if (cachedSecrets) return cachedSecrets;

  // Try AWS Secrets Manager first
  if (client) {
    try {
      const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
      const response = await client.send(command);

      if (response.SecretString) {
        cachedSecrets = JSON.parse(response.SecretString);
        console.log('[Secrets] Loaded from AWS Secrets Manager');
        return cachedSecrets;
      }
    } catch (err) {
      if (err.name !== 'ResourceNotFoundException') {
        console.error('[Secrets] AWS error:', err.message);
      }
      console.log('[Secrets] Falling back to .env');
    }
  }

  // Fallback to process.env
  cachedSecrets = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    // Add any other secrets your repos need
    NOVU_API_KEY: process.env.NOVU_API_KEY,
    NOVU_SECRET_KEY: process.env.NOVU_SECRET_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };

  return cachedSecrets;
}

/**
 * Store secrets in AWS Secrets Manager
 * Use this to vault your existing .env secrets
 */
export async function storeSecrets(secrets) {
  if (!client) {
    throw new Error('AWS Secrets Manager not initialized');
  }

  const secretString = JSON.stringify(secrets);

  try {
    // Try to update existing secret
    const updateCommand = new UpdateSecretCommand({
      SecretId: SECRET_NAME,
      SecretString: secretString,
    });
    await client.send(updateCommand);
    console.log('[Secrets] Updated in AWS Secrets Manager');
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      // Create new secret
      const createCommand = new CreateSecretCommand({
        Name: SECRET_NAME,
        SecretString: secretString,
        Description: 'Fufu Claude Code Slack Bot secrets',
      });
      await client.send(createCommand);
      console.log('[Secrets] Created in AWS Secrets Manager');
    } else {
      throw err;
    }
  }

  // Clear cache so next getSecrets() fetches fresh
  cachedSecrets = null;
}

/**
 * Export secrets to environment variables for Claude CLI
 * This ensures Claude Code has access to all the keys it needs
 */
export async function exportToEnv() {
  const secrets = await getSecrets();

  for (const [key, value] of Object.entries(secrets)) {
    if (value) {
      process.env[key] = value;
    }
  }

  console.log('[Secrets] Exported to environment');
}

/**
 * Validate required secrets are present
 */
export async function validateSecrets() {
  const secrets = await getSecrets();
  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
  const missing = required.filter(key => !secrets[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }

  console.log('[Secrets] Validation passed');
  return true;
}
