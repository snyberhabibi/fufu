# Fufu - Claude Code Slack Bot

You are working on **Fufu** — a Slack bot that runs Claude Code CLI in the cloud via tmux sessions.

---

## PROJECT OVERVIEW

**Repository:** `snyberhabibi/fufu`
**Purpose:** Run Claude Code in the cloud, controlled via Slack
**Tech Stack:** Node.js + @slack/bolt + tmux + Claude Code CLI

### Architecture
```
Slack @mention → Fufu Bot → tmux Session → Claude Code CLI
                                ↓
                    Parse & format response
                                ↓
                    Post to Slack thread
```

---

## KEY FILES

| File | Purpose |
|------|---------|
| `src/bot.js` | Main bot logic (v6) |
| `config/channels.json` | Channel → repo mapping |
| `ecosystem.config.cjs` | PM2 process config |
| `scripts/setup.sh` | EC2 setup script |
| `.env` | Slack tokens (not committed) |

---

## CHANNEL CONFIGURATION

Edit `config/channels.json` to map Slack channels to repos:

```json
{
  "fufu-marketing": {
    "workingDir": "/home/ubuntu/yalla/yalla-bites-marketing",
    "prefix": "mkt"
  },
  "fufu-apply": {
    "workingDir": "/home/ubuntu/yalla/yalla-bites-apply",
    "prefix": "app"
  }
}
```

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

## BOT FEATURES

### Core
- **Thread-based sessions** - Each @mention creates a new thread/session
- **Voice notes** - Transcribes audio messages via Claude
- **Permission handling** - Y/N responses in thread
- **Smart output parsing** - Formats Claude responses for Slack

### Output Formatting
| Claude Output | Slack Display |
|---------------|---------------|
| `⏺ Read(file.ts)` | `📖 Reading \`file.ts\`` |
| `⏺ Edit(file.ts)` | `✏️ Editing \`file.ts\`` |
| `⏺ Bash(...)` | `💻 Running command...` |
| `⏺ Grep/Glob` | `🔍 Searching...` |

### Thread Commands
| Command | Action |
|---------|--------|
| `y` / `yes` | Accept permission |
| `n` / `no` | Reject permission |
| `end` | Kill session |

---

## LOCAL DEVELOPMENT

### Prerequisites
- Node.js 22+
- tmux
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### Setup
```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Add SLACK_BOT_TOKEN and SLACK_APP_TOKEN

# Run locally (for testing)
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

### Quick Deploy
```bash
# SSH to server
ssh ubuntu@<ec2-ip>

# Pull latest
cd ~/yalla/fufu
git pull origin main

# Restart
pm2 restart fufu
```

### Full Setup
```bash
# Run setup script
./scripts/setup.sh

# Trust repos in Claude
cat >> ~/.claude/settings.json << 'EOF'
{
  "trustedPaths": [
    "/home/ubuntu/yalla",
    "/home/ubuntu/yalla/yalla-bites-marketing",
    "/home/ubuntu/yalla/yalla-bites-apply",
    "/home/ubuntu/yalla/yalla-bites-novu",
    "/home/ubuntu/yalla/yalla-bites-hunter"
  ]
}
EOF

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## ENVIRONMENT VARIABLES

```bash
# Slack Bot Token (xoxb-...)
SLACK_BOT_TOKEN=

# Slack App Token for Socket Mode (xapp-...)
SLACK_APP_TOKEN=
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
5. Install to workspace
6. Invite `@Fufu` to channels

---

## GIT WORKFLOW

```bash
# Feature branch
git checkout -b feature/your-feature

# Commit
git add -A
git commit -m "feat: description

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# Push and deploy
git push origin feature/your-feature
# Then: merge to main, pull on EC2, pm2 restart
```

---

## TROUBLESHOOTING

### Bot not responding
1. Check PM2: `pm2 status fufu`
2. Check logs: `pm2 logs fufu`
3. Verify Slack tokens in `.env`

### Session stuck
1. List sessions: `tmux list-sessions`
2. Kill stuck session: `tmux kill-session -t <name>`
3. Or send `end` in Slack thread

### Permission prompt not showing
- Default mode requires y/n in thread
- Use `--auto` for auto-accept
- Use `--dangerous` to skip entirely

### Voice note not transcribing
- Check file format (mp4/m4a supported)
- Verify Claude CLI can access audio: `claude -p "test" --file audio.m4a`

---

## MONITORING

```bash
# PM2 dashboard
pm2 monit

# Session list
tmux list-sessions

# Bot status
pm2 status

# Real-time logs
pm2 logs fufu --lines 100
```

---

*Fufu v6 — Claude Code in the Cloud*
