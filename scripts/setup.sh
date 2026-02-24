#!/bin/bash
# Fufu Setup Script
# Run this on your server after cloning

set -e

echo "==================================="
echo "  Fufu Setup"
echo "==================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js: $(node -v)"

# Check tmux
if ! command -v tmux &> /dev/null; then
    echo "Installing tmux..."
    sudo apt-get install -y tmux
fi

echo "tmux: $(tmux -V)"

# Check Claude Code
if ! command -v claude &> /dev/null; then
    echo "Installing Claude Code..."
    npm install -g @anthropic-ai/claude-code
fi

echo "Claude: $(claude --version 2>/dev/null || echo 'not logged in')"

# Check PM2
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
fi

echo "PM2: $(pm2 -v)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Create logs directory
mkdir -p logs

# Setup .env if not exists
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env from example..."
    cp .env.example .env
    echo "IMPORTANT: Edit .env with your Slack tokens!"
fi

echo ""
echo "==================================="
echo "  Setup Complete!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Edit .env with your Slack tokens"
echo "2. Edit config/channels.json with your repos"
echo "3. Run: claude login (if not already logged in)"
echo "4. Run: pm2 start ecosystem.config.cjs"
echo "5. Run: pm2 save && pm2 startup"
echo ""
