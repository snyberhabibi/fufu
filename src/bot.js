/**
 * Fufu v7 - Claude Code Slack Bot (Beast Mode)
 *
 * Features:
 * - Multi-repo support with channel mapping
 * - Interactive Slack modals with quick actions
 * - fufu-master executive dashboard
 * - AWS Secrets Manager integration
 * - Optimized session management
 * - Memory leak prevention
 * - Graceful shutdown
 */

import { App, LogLevel } from '@slack/bolt';
import { execSync, spawn } from 'child_process';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import https from 'https';
import http from 'http';
import { initSecretsManager, getSecrets, exportToEnv, validateSecrets } from './secrets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
config({ path: join(ROOT_DIR, '.env') });

// Initialize secrets
initSecretsManager();

const CHANNEL_CONFIG = JSON.parse(
  readFileSync(join(ROOT_DIR, 'config', 'channels.json'), 'utf-8')
);

// Session tracking with TTL
const sessions = new Map();
const lastSeenContent = new Map();
const lastSentResponse = new Map();
const pendingResponses = new Map();
const sessionActivity = new Map(); // Track last activity for cleanup

// Constants
const TMUX = process.platform === 'darwin' ? '/opt/homebrew/bin/tmux' : '/usr/bin/tmux';
const TEMP_DIR = '/tmp/fufu-audio';
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS_PER_CHANNEL = 5;

if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

// Quick actions for interactive modals
const QUICK_ACTIONS = {
  'fufu-apply': [
    { id: 'git_status', label: 'Git Status', command: 'git status' },
    { id: 'run_tests', label: 'Run Tests', command: 'npm test' },
    { id: 'build', label: 'Build', command: 'npm run build' },
    { id: 'deploy_preview', label: 'Deploy Preview', command: 'vercel' },
    { id: 'lint_fix', label: 'Lint & Fix', command: 'npm run lint:fix' },
  ],
  'fufu-marketing': [
    { id: 'git_status', label: 'Git Status', command: 'git status' },
    { id: 'dev_server', label: 'Start Dev', command: 'npm run dev' },
    { id: 'build', label: 'Build', command: 'npm run build' },
    { id: 'deploy', label: 'Deploy', command: 'vercel --prod' },
  ],
  'fufu-novu': [
    { id: 'git_status', label: 'Git Status', command: 'git status' },
    { id: 'run_tests', label: 'Run Tests', command: 'npm test' },
    { id: 'workflow_status', label: 'Check Workflows', command: 'Show me the status of all Novu notification workflows' },
  ],
  'fufu-hunter': [
    { id: 'git_status', label: 'Git Status', command: 'git status' },
    { id: 'scrape_status', label: 'Scraper Status', command: 'Check the status of active scrapers' },
    { id: 'run_hunter', label: 'Run Hunter', command: 'Start a new hunting session' },
  ],
  'fufu-master': [
    { id: 'all_status', label: 'All Repos Status', command: 'Give me a status overview of all yalla-bites repos' },
    { id: 'recent_commits', label: 'Recent Activity', command: 'Show recent commits across all repos in the last 24 hours' },
    { id: 'check_deploys', label: 'Check Deployments', command: 'Check deployment status for all projects on Vercel' },
    { id: 'health_check', label: 'Health Check', command: 'Run health checks on all services' },
  ],
};

let app;

async function initApp() {
  await exportToEnv();
  await validateSecrets();
  const secrets = await getSecrets();

  app = new App({
    token: secrets.SLACK_BOT_TOKEN,
    appToken: secrets.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN
  });

  setupEventHandlers();
  return app;
}

const channelCache = new Map();

async function getChannelName(channelId) {
  if (channelCache.has(channelId)) return channelCache.get(channelId);
  try {
    const result = await app.client.conversations.info({ channel: channelId });
    const name = result.channel?.name || null;
    if (name) channelCache.set(channelId, name);
    return name;
  } catch { return null; }
}

async function react(channel, ts, emoji) {
  try { await app.client.reactions.add({ channel, timestamp: ts, name: emoji }); } catch {}
}

async function removeReact(channel, ts, emoji) {
  try { await app.client.reactions.remove({ channel, timestamp: ts, name: emoji }); } catch {}
}

async function postMessage(channel, threadTs, text, blocks = null) {
  try {
    const msg = {
      channel,
      thread_ts: threadTs,
      text,
      unfurl_links: false,
      mrkdwn: true
    };
    if (blocks) msg.blocks = blocks;
    return await app.client.chat.postMessage(msg);
  } catch (e) {
    console.error('[!] Post failed:', e.message);
    return null;
  }
}

async function updateMessage(channel, ts, text, blocks = null) {
  try {
    const msg = { channel, ts, text };
    if (blocks) msg.blocks = blocks;
    return await app.client.chat.update(msg);
  } catch (e) {
    console.error('[!] Update failed:', e.message);
    return null;
  }
}

function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\"'\"'") + "'";
}

function tmuxExists(name) {
  try {
    execSync(`${TMUX} has-session -t ${shellEscape(name)} 2>/dev/null`);
    return true;
  } catch { return false; }
}

function listTmuxSessions() {
  try {
    const output = execSync(`${TMUX} list-sessions -F "#{session_name}"`, { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

async function spawnSession(sessionName, workingDir, dangerous = false) {
  try {
    execSync(`${TMUX} new-session -d -s ${shellEscape(sessionName)} -c ${shellEscape(workingDir)}`);

    const cmd = dangerous ? 'claude --dangerously-skip-permissions' : 'claude';
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '${cmd}' Enter`);

    await waitReady(sessionName);
    sessionActivity.set(sessionName, Date.now());
    console.log(`[+] Session: ${sessionName} (${dangerous ? 'dangerous' : 'normal'} mode)`);
    return true;
  } catch (e) {
    console.error(`[!] Spawn failed: ${e.message}`);
    return false;
  }
}

async function waitReady(sessionName, timeout = 60000) {
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < timeout) {
    try {
      const out = capture(sessionName);
      const lines = out.split('\n').filter(l => l.trim());
      const last = lines[lines.length - 1]?.trim() || '';

      if (last === '>' || last === '> ' || last === '❯' || last === '❯ ') {
        stable++;
        if (stable >= 3) return true;
      } else {
        stable = 0;
      }

      if (out.includes('Yes, I trust') || out.includes('trust this folder')) {
        execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '1' Enter`);
        stable = 0;
      }
      if (out.includes('Use high effort') || out.includes('effort level')) {
        execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '1' Enter`);
        stable = 0;
      }
    } catch {}
    await sleep(500);
  }
  return false;
}

function sendText(sessionName, text) {
  try {
    lastSeenContent.set(sessionName, capture(sessionName));
    sessionActivity.set(sessionName, Date.now());
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} -l ${shellEscape(text)}`);
    execSync('sleep 0.5');
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} Enter`);
    return true;
  } catch { return false; }
}

function sendKey(sessionName, key) {
  try {
    sessionActivity.set(sessionName, Date.now());
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '${key}'`);
    return true;
  } catch { return false; }
}

function capture(sessionName) {
  try {
    return execSync(`${TMUX} capture-pane -t ${shellEscape(sessionName)} -p -S -500`, { encoding: 'utf-8' });
  } catch { return ''; }
}

function killSession(sessionName) {
  try {
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '/exit' Enter`);
    execSync('sleep 1');
    execSync(`${TMUX} kill-session -t ${shellEscape(sessionName)}`);
    console.log(`[-] Killed session: ${sessionName}`);
  } catch {}
}

function isThinking(content) {
  const lines = content.split('\n').slice(-30);
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('✽') || t.startsWith('·')) return true;
    if (t.includes('Thinking') || t.includes('Sussing') || t.includes('Leavening')) return true;
    if (t.includes('Running…') || t.includes('Running...')) return true;
    if (t.includes('(thinking)')) return true;
    if (t.match(/^[⏺●]\s+\w+\([^)]*\)$/) && !lines.some(l => l.trim().startsWith('⎿'))) return true;
  }
  return false;
}

function hasPermissionPrompt(content) {
  const lower = content.toLowerCase();
  return lower.includes('allow this') ||
         lower.includes('do you want to') ||
         lower.includes('(y/n)') ||
         lower.includes('[y/n]') ||
         lower.includes('approve') ||
         lower.includes('allow once') ||
         lower.includes('allow always');
}

function parseResponse(content, sessionName) {
  if (isThinking(content)) return null;

  const lines = content.split('\n');

  let hasEmptyPrompt = false;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    const t = lines[i].trim();
    if (t.startsWith('─') || t === '') continue;
    if (t.includes('|') && (t.includes('%') || t.includes('$'))) continue;
    if (t === '>' || t === '> ' || t === '❯' || t === '❯ ') { hasEmptyPrompt = true; break; }
    if (t.length > 0) break;
  }

  if (!hasEmptyPrompt) return null;

  let userPromptIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if ((t.startsWith('> ') || t.startsWith('❯ ')) && t.length > 2 && !t.startsWith('> ─') && !t.startsWith('❯ ─')) {
      userPromptIndex = i;
      break;
    }
  }

  if (userPromptIndex === -1) return null;

  let responseEndIndex = lines.length;
  for (let i = lines.length - 1; i > userPromptIndex; i--) {
    const t = lines[i].trim();
    if (t === '>' || t === '> ' || t === '❯' || t === '❯ ') { responseEndIndex = i; break; }
  }

  const responseLines = lines.slice(userPromptIndex + 1, responseEndIndex);
  const cleanedLines = [];
  let currentSection = null;

  for (const line of responseLines) {
    const t = line.trim();

    if (t === '' || t.startsWith('─')) continue;
    if (t.includes('|') && (t.includes('%') || t.includes('$'))) continue;
    if (t.startsWith('○') || t.startsWith('✽')) continue;
    if (t.startsWith('·') && t.includes('…')) continue;
    if (t.includes('Claude Code v') || t.includes('Opus 4')) continue;
    if (t.includes('Share Claude Code')) continue;
    if (t.includes('Auto-update failed')) continue;

    if (t.startsWith('⏺') || t.startsWith('●')) {
      const marker = t.startsWith('⏺') ? '⏺' : '●';
      const toolMatch = t.match(new RegExp(`^[${marker}]\\s+(\\w+)\\(([^)]*)\\)`));
      if (toolMatch) {
        const [, tool, args] = toolMatch;
        if (tool === 'Read') cleanedLines.push(`📖 Reading \`${args}\``);
        else if (tool === 'Edit') cleanedLines.push(`✏️ Editing \`${args.split(',')[0]}\``);
        else if (tool === 'Write') cleanedLines.push(`📝 Writing \`${args}\``);
        else if (tool === 'Bash') cleanedLines.push(`💻 Running command...`);
        else if (tool === 'Glob' || tool === 'Grep') cleanedLines.push(`🔍 Searching...`);
        else if (tool === 'Skill') cleanedLines.push(`🎯 Loading skill...`);
        else if (tool === 'Task') cleanedLines.push(`🤖 Spawning agent...`);
        else cleanedLines.push(`🔧 ${tool}...`);
        currentSection = tool;
        continue;
      }
      const text = t.replace(/^[⏺●]\s*/, '');
      if (text) cleanedLines.push(text);
    }
    else if (t.startsWith('⎿')) {
      const text = t.replace(/^⎿\s*/, '');
      if (currentSection === 'Bash' && text) {
        if (text.length < 200) {
          cleanedLines.push('```');
          cleanedLines.push(text);
          cleanedLines.push('```');
        } else {
          cleanedLines.push(`_(${text.length} chars)_`);
        }
      } else if (text && text.length < 100) {
        cleanedLines.push(`  ↳ ${text}`);
      }
      currentSection = null;
    }
  }

  while (cleanedLines.length && cleanedLines[0] === '') cleanedLines.shift();
  while (cleanedLines.length && cleanedLines[cleanedLines.length - 1] === '') cleanedLines.pop();

  let response = cleanedLines.join('\n').trim();

  const lastSent = lastSentResponse.get(sessionName);
  if (!response || response === lastSent) return null;

  lastSentResponse.set(sessionName, response);
  return response;
}

async function pollOutputs() {
  for (const [threadTs, session] of sessions) {
    if (!tmuxExists(session.sessionName)) {
      cleanup(session.sessionName, threadTs);
      continue;
    }

    const pending = pendingResponses.get(session.sessionName);
    if (!pending) continue;

    const current = capture(session.sessionName);

    if (session.autoAccept && !session.dangerous && hasPermissionPrompt(current)) {
      sendKey(session.sessionName, 'y');
      console.log(`[Auto] Accepted: ${session.sessionName}`);
      continue;
    }

    const response = parseResponse(current, session.sessionName);

    if (response) {
      await removeReact(pending.channelId, pending.triggerTs, 'brain');

      const chunks = chunkText(response, 3800);
      for (const chunk of chunks) {
        await postMessage(pending.channelId, threadTs, chunk);
        if (chunks.length > 1) await sleep(300);
      }

      lastSeenContent.set(session.sessionName, current);
      pendingResponses.delete(session.sessionName);
    }
  }
}

function cleanup(sessionName, threadTs) {
  sessions.delete(threadTs);
  lastSeenContent.delete(sessionName);
  lastSentResponse.delete(sessionName);
  pendingResponses.delete(sessionName);
  sessionActivity.delete(sessionName);
  console.log(`[Cleanup] Session removed: ${sessionName}`);
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let end = Math.min(remaining.length, max);
    if (remaining.length > max) {
      const nl = remaining.lastIndexOf('\n', max);
      if (nl > max * 0.5) end = nl;
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Audio handling
async function downloadFile(url, dest) {
  const secrets = await getSecrets();
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { Authorization: `Bearer ${secrets.SLACK_BOT_TOKEN}` } }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', reject);
  });
}

async function transcribe(filePath) {
  try {
    return execSync(
      `claude -p "Transcribe this audio exactly. Output only the transcription." --file ${shellEscape(filePath)}`,
      { encoding: 'utf-8', timeout: 60000 }
    ).trim();
  } catch { return null; }
}

// Build quick action blocks for Slack
function buildQuickActionBlocks(channelName) {
  const actions = QUICK_ACTIONS[channelName] || [];
  if (actions.length === 0) return null;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quick Actions for ${channelName}*\nSelect an action or type your own request:`
      }
    },
    {
      type: 'actions',
      elements: actions.slice(0, 5).map(action => ({
        type: 'button',
        text: { type: 'plain_text', text: action.label, emoji: true },
        value: JSON.stringify({ action: action.id, command: action.command, channel: channelName }),
        action_id: `quick_action_${action.id}`
      }))
    }
  ];

  // Add mode selection
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🔒 Normal Mode', emoji: true },
        value: 'normal',
        action_id: 'mode_normal'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '⚡ Auto Mode', emoji: true },
        value: 'auto',
        action_id: 'mode_auto'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '💀 Dangerous Mode', emoji: true },
        style: 'danger',
        value: 'dangerous',
        action_id: 'mode_dangerous'
      }
    ]
  });

  return blocks;
}

// Build executive dashboard for fufu-master
async function buildExecutiveDashboard() {
  const tmuxSessions = listTmuxSessions();
  const activeSessions = [];

  for (const [threadTs, session] of sessions) {
    if (tmuxExists(session.sessionName)) {
      const lastActivity = sessionActivity.get(session.sessionName) || Date.now();
      const idle = Math.floor((Date.now() - lastActivity) / 1000 / 60);
      activeSessions.push({
        name: session.sessionName,
        channel: session.channelId,
        mode: session.dangerous ? 'dangerous' : session.autoAccept ? 'auto' : 'normal',
        idle: `${idle}m`
      });
    }
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🎯 Fufu Executive Dashboard', emoji: true }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Active Sessions:* ${activeSessions.length}\n*tmux Sessions:* ${tmuxSessions.length}`
      }
    }
  ];

  // Show active sessions
  if (activeSessions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Current Sessions:*\n' + activeSessions.map(s =>
          `• \`${s.name}\` (${s.mode}) - idle ${s.idle}`
        ).join('\n')
      }
    });
  }

  // Quick commands for master
  blocks.push(
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Executive Actions:*' }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 All Repos Status', emoji: true },
          value: 'all_status',
          action_id: 'exec_all_status'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 Recent Activity', emoji: true },
          value: 'recent_activity',
          action_id: 'exec_recent_activity'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🚀 Deployments', emoji: true },
          value: 'deployments',
          action_id: 'exec_deployments'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🧹 Cleanup Sessions', emoji: true },
          style: 'danger',
          value: 'cleanup',
          action_id: 'exec_cleanup'
        }
      ]
    }
  );

  return blocks;
}

function setupEventHandlers() {
  // Handle @mentions
  app.event('app_mention', async ({ event }) => {
    const channelId = event.channel;
    const channelName = await getChannelName(channelId);
    const msgTs = event.ts;
    const threadTs = event.thread_ts || event.ts;

    if (!channelName || !CHANNEL_CONFIG[channelName]) {
      await react(channelId, msgTs, 'x');
      return;
    }

    let text = (event.text || '').replace(/<@[A-Z0-9]+>/gi, '').trim();

    // Voice notes
    if (event.files) {
      for (const file of event.files) {
        if (file.mimetype?.startsWith('audio/')) {
          await react(channelId, msgTs, 'microphone');
          const audioPath = join(TEMP_DIR, `${Date.now()}.mp4`);
          try {
            await downloadFile(file.url_private_download, audioPath);
            const transcript = await transcribe(audioPath);
            if (transcript) {
              text = (text + ' ' + transcript).trim();
              await removeReact(channelId, msgTs, 'microphone');
              await react(channelId, msgTs, 'speech_balloon');
            }
            try { unlinkSync(audioPath); } catch {}
          } catch {}
        }
      }
    }

    // If empty mention, show quick actions
    if (!text) {
      if (channelName === 'fufu-master') {
        const blocks = await buildExecutiveDashboard();
        await postMessage(channelId, threadTs, 'Fufu Executive Dashboard', blocks);
      } else {
        const blocks = buildQuickActionBlocks(channelName);
        if (blocks) {
          await postMessage(channelId, threadTs, `Quick actions for ${channelName}`, blocks);
        }
      }
      return;
    }

    // Parse flags
    const dangerous = text.includes('--dangerous') || text.includes('--yolo');
    const autoAccept = text.includes('--auto');
    text = text.replace(/--(dangerous|yolo|auto)/gi, '').trim();

    await react(channelId, msgTs, 'brain');

    let session = sessions.get(threadTs);

    if (!session) {
      const cfg = CHANNEL_CONFIG[channelName];
      const sessionName = `${cfg.prefix}-${Date.now().toString(36)}`;

      const ok = await spawnSession(sessionName, cfg.workingDir, dangerous);
      if (!ok) {
        await removeReact(channelId, msgTs, 'brain');
        await react(channelId, msgTs, 'x');
        await postMessage(channelId, threadTs, '❌ Failed to start Claude session. Check server logs.');
        return;
      }

      session = {
        sessionName,
        channelId,
        channelName,
        autoAccept: autoAccept || dangerous,
        dangerous,
        createdAt: Date.now()
      };
      sessions.set(threadTs, session);
    }

    if (autoAccept) session.autoAccept = true;

    pendingResponses.set(session.sessionName, { channelId, threadTs, triggerTs: msgTs });
    sendText(session.sessionName, text);
  });

  // Handle button clicks for quick actions
  app.action(/^quick_action_/, async ({ action, body, ack }) => {
    await ack();

    const data = JSON.parse(action.value);
    const channelId = body.channel.id;
    const threadTs = body.message.thread_ts || body.message.ts;
    const channelName = data.channel;
    const cfg = CHANNEL_CONFIG[channelName];

    if (!cfg) return;

    // Get or create session
    let session = sessions.get(threadTs);
    if (!session) {
      const sessionName = `${cfg.prefix}-${Date.now().toString(36)}`;
      const ok = await spawnSession(sessionName, cfg.workingDir, false);
      if (!ok) {
        await postMessage(channelId, threadTs, '❌ Failed to start session');
        return;
      }

      session = {
        sessionName,
        channelId,
        channelName,
        autoAccept: false,
        dangerous: false,
        createdAt: Date.now()
      };
      sessions.set(threadTs, session);
    }

    await react(channelId, body.message.ts, 'brain');
    pendingResponses.set(session.sessionName, { channelId, threadTs, triggerTs: body.message.ts });
    sendText(session.sessionName, data.command);
  });

  // Handle mode buttons
  app.action(/^mode_/, async ({ action, body, ack }) => {
    await ack();

    const mode = action.value;
    const channelId = body.channel.id;
    const threadTs = body.message.thread_ts || body.message.ts;

    const session = sessions.get(threadTs);
    if (session) {
      if (mode === 'auto') {
        session.autoAccept = true;
        session.dangerous = false;
        await postMessage(channelId, threadTs, '⚡ Auto mode enabled - will auto-accept permissions');
      } else if (mode === 'dangerous') {
        session.autoAccept = true;
        session.dangerous = true;
        await postMessage(channelId, threadTs, '💀 Dangerous mode - all permissions bypassed');
      } else {
        session.autoAccept = false;
        session.dangerous = false;
        await postMessage(channelId, threadTs, '🔒 Normal mode - will prompt for permissions');
      }
    } else {
      await postMessage(channelId, threadTs, `Mode set to *${mode}* for next session`);
    }
  });

  // Handle executive actions
  app.action(/^exec_/, async ({ action, body, ack }) => {
    await ack();

    const actionId = action.action_id.replace('exec_', '');
    const channelId = body.channel.id;
    const threadTs = body.message.thread_ts || body.message.ts;
    const cfg = CHANNEL_CONFIG['fufu-master'];

    if (actionId === 'cleanup') {
      // Kill stale sessions
      let killed = 0;
      for (const [ts, session] of sessions) {
        const lastActivity = sessionActivity.get(session.sessionName) || 0;
        if (Date.now() - lastActivity > SESSION_TTL) {
          killSession(session.sessionName);
          cleanup(session.sessionName, ts);
          killed++;
        }
      }
      await postMessage(channelId, threadTs, `🧹 Cleaned up ${killed} stale sessions`);
      return;
    }

    // Other actions need Claude
    let session = sessions.get(threadTs);
    if (!session) {
      const sessionName = `main-${Date.now().toString(36)}`;
      const ok = await spawnSession(sessionName, cfg.workingDir, false);
      if (!ok) {
        await postMessage(channelId, threadTs, '❌ Failed to start executive session');
        return;
      }

      session = {
        sessionName,
        channelId,
        channelName: 'fufu-master',
        autoAccept: true,
        dangerous: false,
        createdAt: Date.now()
      };
      sessions.set(threadTs, session);
    }

    let command = '';
    if (actionId === 'all_status') {
      command = 'Give me a brief status of each repo in /home/ubuntu/yalla: yalla-bites-apply, yalla-bites-marketing, yalla-bites-novu, yalla-bites-hunter. Show git status, any uncommitted changes, and last commit for each.';
    } else if (actionId === 'recent_activity') {
      command = 'Show me the git log --oneline -5 for each repo in /home/ubuntu/yalla (apply, marketing, novu, hunter). Format nicely.';
    } else if (actionId === 'deployments') {
      command = 'Check Vercel deployment status. Run: vercel ls --limit 3 in each project directory if vercel.json exists.';
    }

    if (command) {
      await react(channelId, body.message.ts, 'brain');
      pendingResponses.set(session.sessionName, { channelId, threadTs, triggerTs: body.message.ts });
      sendText(session.sessionName, command);
    }
  });

  // Handle thread replies
  app.message(async ({ message }) => {
    if ('bot_id' in message) return;
    if (!message.thread_ts) return;

    const session = sessions.get(message.thread_ts);
    if (!session) return;

    let text = (message.text || '').replace(/<@[A-Z0-9]+>/gi, '').trim();
    if (!text) return;

    const lower = text.toLowerCase();

    // Permission responses
    if (lower === 'y' || lower === 'yes') {
      sendKey(session.sessionName, 'y');
      await react(message.channel, message.ts, 'white_check_mark');
      return;
    }
    if (lower === 'n' || lower === 'no') {
      sendKey(session.sessionName, 'n');
      await react(message.channel, message.ts, 'x');
      return;
    }
    if (lower === '/end' || lower === 'end') {
      killSession(session.sessionName);
      cleanup(session.sessionName, message.thread_ts);
      await react(message.channel, message.ts, 'wave');
      return;
    }

    // Voice in thread
    if (message.files) {
      for (const file of message.files) {
        if (file.mimetype?.startsWith('audio/')) {
          await react(message.channel, message.ts, 'microphone');
          const audioPath = join(TEMP_DIR, `${Date.now()}.mp4`);
          try {
            await downloadFile(file.url_private_download, audioPath);
            const transcript = await transcribe(audioPath);
            if (transcript) {
              text = (text + ' ' + transcript).trim();
              await removeReact(message.channel, message.ts, 'microphone');
            }
            try { unlinkSync(audioPath); } catch {}
          } catch {}
        }
      }
    }

    if (text.includes('--auto')) {
      session.autoAccept = true;
      text = text.replace(/--auto/gi, '').trim();
    }

    await react(message.channel, message.ts, 'brain');

    pendingResponses.set(session.sessionName, {
      channelId: message.channel,
      threadTs: message.thread_ts,
      triggerTs: message.ts
    });

    sendText(session.sessionName, text);
  });
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // Kill all sessions
  for (const [threadTs, session] of sessions) {
    console.log(`[Shutdown] Killing session: ${session.sessionName}`);
    killSession(session.sessionName);
    cleanup(session.sessionName, threadTs);
  }

  console.log('[Shutdown] Complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Cleanup stale sessions periodically (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ts, s] of sessions) {
    if (!tmuxExists(s.sessionName)) {
      cleanup(s.sessionName, ts);
      continue;
    }

    const lastActivity = sessionActivity.get(s.sessionName) || 0;
    if (now - lastActivity > SESSION_TTL) {
      console.log(`[Cleanup] Stale session: ${s.sessionName}`);
      killSession(s.sessionName);
      cleanup(s.sessionName, ts);
    }
  }
}, 10 * 60 * 1000);

// Poll outputs
setInterval(pollOutputs, 800);

// Start
(async () => {
  try {
    await initApp();
    await app.start();

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║      🦊 Fufu v7 - Beast Mode Active      ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Channels:                               ║');
    Object.keys(CHANNEL_CONFIG).forEach(ch => {
      console.log(`║    • ${ch.padEnd(35)}║`);
    });
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Features:                               ║');
    console.log('║    • Interactive quick actions           ║');
    console.log('║    • Executive dashboard (fufu-master)   ║');
    console.log('║    • AWS Secrets Manager                 ║');
    console.log('║    • Voice transcription                 ║');
    console.log('║    • Auto session cleanup                ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log('Modes: normal (default) | --auto | --dangerous');
    console.log('');
  } catch (err) {
    console.error('[Fatal]', err.message);
    process.exit(1);
  }
})();
