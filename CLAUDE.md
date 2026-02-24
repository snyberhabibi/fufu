# Fufu - Claude Code Slack Bot

You are working on **Fufu v7 (Beast Mode)** — a Slack bot that runs Claude Code CLI in the cloud via tmux sessions.

---

## PROJECT OVERVIEW

**Repository:** `snyberhabibi/fufu`
**Purpose:** Run Claude Code in the cloud, controlled via Slack with full API parity
**Tech Stack:** Node.js + @slack/bolt + tmux + Claude Code CLI + AWS Secrets Manager

### Architecture
```
Slack @mention → Fufu Bot → tmux Session → Claude Code CLI
                     ↓
            Interactive Quick Actions
            Executive Dashboard (fufu-master)
                     ↓
            Parse & format response
                     ↓
            Post to Slack thread
```

---

## KEY FILES

| File | Purpose |
|------|---------|
| `src/bot.js` | Main bot logic (v7 Beast Mode) |
| `src/secrets.js` | AWS Secrets Manager integration |
| `config/channels.json` | Channel → repo mapping |
| `scripts/vault-secrets.js` | Vault .env to AWS |
| `ecosystem.config.cjs` | PM2 process config |
| `docs/EC2_SETUP.md` | Full EC2 setup guide |

---

## CHANNEL CONFIGURATION

All 5 channels are pre-configured in `config/channels.json`:

| Channel | Repo | Prefix |
|---------|------|--------|
| `fufu-apply` | yalla-bites-apply | app |
| `fufu-marketing` | yalla-bites-marketing | mkt |
| `fufu-novu` | yalla-bites-novu | novu |
| `fufu-hunter` | yalla-bites-hunter | hunt |
| `fufu-master` | yalla (all repos) | main |

---

## INTERACTIVE QUICK ACTIONS

When you @mention Fufu with no text, it shows quick action buttons:

### Per-Channel Actions
- **Git Status** - Check current git state
- **Run Tests** - Execute test suite
- **Build** - Run build process
- **Deploy** - Deploy to Vercel/production

### fufu-master Executive Actions
- **All Repos Status** - Git status across all repos
- **Recent Activity** - Last 5 commits per repo
- **Deployments** - Vercel deployment status
- **Cleanup Sessions** - Kill stale tmux sessions

### Mode Selection Buttons
- **Normal Mode** - Prompts for permissions (y/n)
- **Auto Mode** - Auto-accepts all permissions
- **Dangerous Mode** - Bypasses all prompts

---

## PERMISSION MODES

| Mode | Flag | Behavior |
|------|------|----------|
| **Normal** | (default) | Prompts for Edit/Bash, user replies y/n |
| **Auto** | `--auto` | Auto-accepts all permissions |
| **Dangerous** | `--dangerous` | Skips all prompts entirely |

### Usage Examples
```
@Fufu fix the bug in api.ts
@Fufu --auto refactor the auth module
@Fufu --dangerous deploy to production
```

---

## AWS SECRETS MANAGER

All API keys are stored securely in AWS Secrets Manager.

### Vault Your Secrets
```bash
# Set AWS credentials
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1

# Run vault script
node scripts/vault-secrets.js
```

### Supported Secrets
- Slack tokens
- Anthropic API key
- Supabase credentials
- Novu API keys
- Stripe keys
- Vercel token
- GitHub token
- Resend API key
- Cloudflare credentials
- And more...

---

## BOT FEATURES

### Core
- **Thread-based sessions** - Each @mention creates a new thread/session
- **Voice notes** - Transcribes audio messages via Claude
- **Permission handling** - Y/N responses or button clicks
- **Smart output parsing** - Formats Claude responses for Slack
- **Interactive modals** - Quick action buttons

### v7 Enhancements
- **Executive Dashboard** - fufu-master monitors all activity
- **AWS Secrets Manager** - Secure credential storage
- **Session TTL** - Auto-cleanup after 30 minutes idle
- **Graceful Shutdown** - Clean session termination
- **Memory Leak Prevention** - Proper Map cleanup

### Output Formatting
| Claude Output | Slack Display |
|---------------|---------------|
| `⏺ Read(file.ts)` | `📖 Reading \`file.ts\`` |
| `⏺ Edit(file.ts)` | `✏️ Editing \`file.ts\`` |
| `⏺ Write(file.ts)` | `📝 Writing \`file.ts\`` |
| `⏺ Bash(...)` | `💻 Running command...` |
| `⏺ Grep/Glob` | `🔍 Searching...` |
| `⏺ Task(...)` | `🤖 Spawning agent...` |

### Thread Commands
| Command | Action |
|---------|--------|
| `y` / `yes` | Accept permission |
| `n` / `no` | Reject permission |
| `end` | Kill session |
| `--auto` | Enable auto-accept |

---

## LOCAL DEVELOPMENT

### Prerequisites
- Node.js 22+
- tmux
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- AWS CLI (optional, for Secrets Manager)

### Setup
```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Add SLACK_BOT_TOKEN and SLACK_APP_TOKEN

# Run locally
node src/bot.js
```

### Testing
```bash
# Check tmux sessions
tmux list-sessions

# Attach to session
tmux attach -t <session-name>

# View bot logs
pm2 logs fufu
```

---

## DEPLOYMENT (EC2)

See `docs/EC2_SETUP.md` for complete guide.

### Quick Deploy
```bash
ssh ubuntu@<ec2-ip>
cd ~/yalla/fufu
git pull origin main
npm install
pm2 restart fufu
```

---

## SLACK APP SETUP

1. Create app at https://api.slack.com/apps
2. Enable **Socket Mode** → Create app-level token
3. **OAuth & Permissions** → Add scopes:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `files:read`
   - `reactions:read`
   - `reactions:write`
4. **Event Subscriptions** → Subscribe to:
   - `app_mention`
   - `message.channels`
5. **Interactivity** → Enable (required for buttons)
6. Install to workspace
7. Invite `@Fufu` to all fufu-* channels

---

## TROUBLESHOOTING

### Bot not responding
1. Check PM2: `pm2 status fufu`
2. Check logs: `pm2 logs fufu --lines 50`
3. Verify Slack tokens: `echo $SLACK_BOT_TOKEN`

### Session stuck
1. List sessions: `tmux list-sessions`
2. Kill: `tmux kill-session -t <name>`
3. Or in Slack: reply `end` in thread

### Secrets not loading
```bash
aws secretsmanager get-secret-value --secret-id fufu/production
```

### Quick actions not showing
- Ensure Interactivity is enabled in Slack app settings
- Check channel is in `config/channels.json`

---

## MONITORING

```bash
# PM2 dashboard
pm2 monit

# Session list
tmux list-sessions

# Real-time logs
pm2 logs fufu --lines 100

# Executive dashboard
# @Fufu in #fufu-master (shows all sessions)
```

---

*Fufu v7 — Beast Mode — Claude Code in the Cloud*
