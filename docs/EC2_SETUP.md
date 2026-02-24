# Fufu EC2 Setup Guide

Complete guide for setting up Fufu v7 (Beast Mode) on EC2 with full API parity.

## Prerequisites

- Ubuntu 22.04+ EC2 instance (t3.medium recommended)
- Node.js 22+
- tmux
- Claude Code CLI (logged in with your Anthropic account)
- AWS CLI configured

## Quick Setup

```bash
# SSH to your EC2 instance
ssh ubuntu@<ec2-ip>

# Clone repos
mkdir -p /home/ubuntu/yalla
cd /home/ubuntu/yalla
git clone <your-repos>

# Clone Fufu
git clone https://github.com/snyberhabibi/fufu.git
cd fufu

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env  # Add your secrets
```

## Required API Keys & Secrets

These are all the keys you need for full parity with local development:

### Slack (Required)
```bash
SLACK_BOT_TOKEN=xoxb-...      # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...      # App-Level Token for Socket Mode
```

### AWS (Required for Secrets Manager)
```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

### Anthropic (Optional - Claude CLI handles auth)
```bash
ANTHROPIC_API_KEY=sk-ant-...  # If you need direct API access
```

### Supabase (for yalla-bites-apply)
```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
DATABASE_URL=postgresql://...
```

### Novu (for yalla-bites-novu)
```bash
NOVU_API_KEY=...
NOVU_SECRET_KEY=...
```

### Vercel (for deployments)
```bash
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
VERCEL_PROJECT_ID=...
```

### Stripe (for payments)
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Resend (for emails)
```bash
RESEND_API_KEY=re_...
```

### GitHub (for repo access)
```bash
GITHUB_TOKEN=ghp_...
```

### OpenAI (if used)
```bash
OPENAI_API_KEY=sk-...
```

### Cloudflare (for DNS/CDN)
```bash
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...
```

### Sentry (for error tracking)
```bash
SENTRY_DSN=https://...@sentry.io/...
```

## Vault Secrets to AWS

Once you have all secrets in `.env`, vault them to AWS Secrets Manager:

```bash
# Set AWS credentials first
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_REGION=us-east-1

# Run vault script
node scripts/vault-secrets.js
```

After vaulting, your EC2 `.env` only needs:
```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

## Claude Code Setup

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Login (interactive)
claude login

# Trust repos
cat >> ~/.claude/settings.json << 'EOF'
{
  "trustedPaths": [
    "/home/ubuntu/yalla",
    "/home/ubuntu/yalla/yalla-bites-apply",
    "/home/ubuntu/yalla/yalla-bites-marketing",
    "/home/ubuntu/yalla/yalla-bites-novu",
    "/home/ubuntu/yalla/yalla-bites-hunter",
    "/home/ubuntu/yalla/fufu"
  ]
}
EOF
```

## PM2 Setup

```bash
# Install PM2
npm install -g pm2

# Start Fufu
cd /home/ubuntu/yalla/fufu
pm2 start ecosystem.config.cjs

# Save & Enable startup
pm2 save
pm2 startup
# Run the command it outputs
```

## Verify Installation

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs fufu

# Verify tmux
tmux list-sessions

# Test Claude CLI
claude -p "Hello, this is a test"
```

## Slack Channel Setup

1. Create these Slack channels:
   - `fufu-apply` - yalla-bites-apply repo
   - `fufu-marketing` - yalla-bites-marketing repo
   - `fufu-novu` - yalla-bites-novu repo
   - `fufu-hunter` - yalla-bites-hunter repo
   - `fufu-master` - Executive dashboard (all repos)

2. Invite @Fufu to each channel

3. Test with: `@Fufu` (should show quick actions)

## Troubleshooting

### Bot not responding
```bash
pm2 logs fufu --lines 50
```

### Session stuck
```bash
tmux kill-session -t <session-name>
# Or in Slack: reply "end" in thread
```

### Claude not starting
```bash
# Check Claude is logged in
claude -p "test"

# Re-login if needed
claude login
```

### Secrets not loading
```bash
# Test AWS access
aws secretsmanager get-secret-value --secret-id fufu/production
```

## Security Notes

1. Use IAM roles instead of static credentials when possible
2. Restrict EC2 security group to only necessary ports
3. Use `--dangerous` mode only when absolutely necessary
4. Regularly rotate API keys
5. Monitor CloudWatch for unusual activity

## Updating

```bash
cd /home/ubuntu/yalla/fufu
git pull origin main
npm install
pm2 restart fufu
```
