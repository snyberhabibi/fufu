# Fufu - Claude Code Slack Bot

Run Claude Code in the cloud, controlled via Slack. Full parity with local Claude Code CLI.

## Features

- **Full Claude Code Parity** - Same capabilities as local CLI
- **Voice Notes** - Speak to Claude via Slack audio messages
- **Multi-Repo Support** - Each Slack channel maps to a different repo
- **Auto-Accept Mode** - Skip permission prompts with `--auto` flag
- **Smart Formatting** - Slack-native output with code blocks and emojis

## Architecture

```
Slack Message → Fufu Bot → tmux Session → Claude Code CLI
                              ↓
                    Response parsed & formatted
                              ↓
                    Posted back to Slack thread
```

## Quick Start

### Prerequisites

- Ubuntu 22.04+ (EC2 or VPS)
- Node.js 22+
- Claude Code CLI installed and authenticated (`claude login`)
- tmux
- Slack App with Socket Mode enabled

### 1. Clone and Install

```bash
git clone https://github.com/snyberhabibi/fufu.git
cd fufu
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Slack tokens
```

### 3. Configure Channels

Edit `config/channels.json` to map Slack channels to repos:

```json
{
  "fufu-frontend": {
    "workingDir": "/home/ubuntu/repos/frontend",
    "prefix": "fe"
  }
}
```

### 4. Trust Working Directories

Add your repos to Claude's trusted paths:

```bash
cat >> ~/.claude/settings.json << 'EOF'
{
  "trustedPaths": [
    "/home/ubuntu/repos/frontend",
    "/home/ubuntu/repos/backend"
  ]
}
EOF
```

### 5. Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Usage

### Basic Commands

| In Slack | Effect |
|----------|--------|
| `@Fufu <message>` | Start session, send message |
| Reply in thread | Continue conversation |
| `y` or `yes` | Accept permission |
| `n` or `no` | Reject permission |
| `end` | End session |

### Claude Commands (passed through)

| Command | Effect |
|---------|--------|
| `/plan` | Enter plan mode |
| `/compact` | Compact conversation |
| `/clear` | Clear context |

### Flags

| Flag | Effect |
|------|--------|
| `--auto` | Auto-accept all permissions |
| `--dangerous` | Skip permission prompts entirely |

### Voice Notes

Just record a voice message in Slack. Fufu will:
1. Transcribe the audio
2. Send to Claude
3. Return the response

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot token (xoxb-...) |
| `SLACK_APP_TOKEN` | App token for Socket Mode (xapp-...) |

### Channel Config

Edit `config/channels.json`:

```json
{
  "channel-name": {
    "workingDir": "/absolute/path/to/repo",
    "prefix": "short-prefix"
  }
}
```

## Slack App Setup

1. Create app at https://api.slack.com/apps
2. Enable **Socket Mode** → Create app token
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
6. Invite bot to channels

## Deployment

### EC2 Setup

```bash
# Install dependencies
sudo apt update && sudo apt install -y nodejs npm tmux

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate Claude
claude login

# Clone and start
git clone https://github.com/snyberhabibi/fufu.git
cd fufu && npm install
pm2 start ecosystem.config.cjs
```

### Monitoring

```bash
# View logs
pm2 logs fufu

# Check status
pm2 status

# View tmux sessions
tmux list-sessions
```

## License

MIT
