/**
 * Fufu v6 - Claude Code Slack Bot
 *
 * Behavior:
 * - Every @mention creates a new thread
 * - Default: normal mode (prompts for permissions, you reply y/n)
 * - --auto flag: auto-accept all permissions
 * - --dangerous flag: skip all permission prompts entirely
 */

import { App, LogLevel } from '@slack/bolt';
import { execSync } from 'child_process';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
config({ path: join(ROOT_DIR, '.env') });

const CHANNEL_CONFIG = JSON.parse(
  readFileSync(join(ROOT_DIR, 'config', 'channels.json'), 'utf-8')
);

const sessions = new Map();
const lastSeenContent = new Map();
const lastSentResponse = new Map();
const pendingResponses = new Map();

const TMUX = process.platform === 'darwin' ? '/opt/homebrew/bin/tmux' : '/usr/bin/tmux';
const TEMP_DIR = '/tmp/fufu-audio';
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.WARN
});

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

async function postMessage(channel, threadTs, text) {
  try {
    return await app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
      unfurl_links: false,
      mrkdwn: true
    });
  } catch (e) {
    console.error('[!] Post failed:', e.message);
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

// Spawn Claude session
// dangerous=true: --dangerously-skip-permissions (no prompts at all)
// dangerous=false: normal mode (will prompt for edits/bash)
async function spawnSession(sessionName, workingDir, dangerous = false) {
  try {
    execSync(`${TMUX} new-session -d -s ${shellEscape(sessionName)} -c ${shellEscape(workingDir)}`);

    // Only use --dangerously-skip-permissions if explicitly requested
    const cmd = dangerous ? 'claude --dangerously-skip-permissions' : 'claude';
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} '${cmd}' Enter`);

    await waitReady(sessionName);
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

      // Check for empty prompt (both > and ❯ variants)
      if (last === '>' || last === '> ' || last === '❯' || last === '❯ ') {
        stable++;
        if (stable >= 3) return true;
      } else {
        stable = 0;
      }

      // Auto-handle first-run prompts
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
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} -l ${shellEscape(text)}`);
    execSync('sleep 0.5');
    execSync(`${TMUX} send-keys -t ${shellEscape(sessionName)} Enter`);
    return true;
  } catch { return false; }
}

function sendKey(sessionName, key) {
  try {
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
  } catch {}
}

function isThinking(content) {
  const lines = content.split('\n').slice(-30);
  for (const line of lines) {
    const t = line.trim();
    // Check for thinking indicators
    if (t.startsWith('✽') || t.startsWith('·')) return true;
    if (t.includes('Thinking') || t.includes('Sussing') || t.includes('Leavening')) return true;
    if (t.includes('Running…') || t.includes('Running...')) return true;
    if (t.includes('(thinking)')) return true;
    // Tool call without result yet (both ⏺ and ● markers)
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

  // Find empty prompt at end
  let hasEmptyPrompt = false;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    const t = lines[i].trim();
    if (t.startsWith('─') || t === '') continue;
    if (t.includes('|') && (t.includes('%') || t.includes('$'))) continue;
    // Check both > and ❯ prompt variants
    if (t === '>' || t === '> ' || t === '❯' || t === '❯ ') { hasEmptyPrompt = true; break; }
    if (t.length > 0) break;
  }

  if (!hasEmptyPrompt) return null;

  // Find user prompt (both > and ❯ variants)
  let userPromptIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if ((t.startsWith('> ') || t.startsWith('❯ ')) && t.length > 2 && !t.startsWith('> ─') && !t.startsWith('❯ ─')) {
      userPromptIndex = i;
      break;
    }
  }

  if (userPromptIndex === -1) return null;

  // Find end of response (both > and ❯ variants)
  let responseEndIndex = lines.length;
  for (let i = lines.length - 1; i > userPromptIndex; i--) {
    const t = lines[i].trim();
    if (t === '>' || t === '> ' || t === '❯' || t === '❯ ') { responseEndIndex = i; break; }
  }

  // Extract and format
  const responseLines = lines.slice(userPromptIndex + 1, responseEndIndex);
  const cleanedLines = [];
  let currentSection = null;

  for (const line of responseLines) {
    const t = line.trim();

    // Skip noise
    if (t === '' || t.startsWith('─')) continue;
    if (t.includes('|') && (t.includes('%') || t.includes('$'))) continue;
    // Skip thinking indicators (but NOT response markers)
    if (t.startsWith('○') || t.startsWith('✽')) continue;
    if (t.startsWith('·') && t.includes('…')) continue; // "Leavening…" etc
    if (t.includes('Claude Code v') || t.includes('Opus 4')) continue;
    if (t.includes('Share Claude Code')) continue;
    if (t.includes('Auto-update failed')) continue;

    // Claude's response (both ⏺ and ● markers)
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

    // Auto-accept if flag set (but NOT if dangerous mode - those don't prompt)
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

// Audio
async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }, res => {
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

setInterval(pollOutputs, 800);

// Handle @mentions - ALWAYS create a thread
app.event('app_mention', async ({ event }) => {
  const channelId = event.channel;
  const channelName = await getChannelName(channelId);
  const msgTs = event.ts;

  // Always use message ts as thread - this creates a new thread for each mention
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

  if (!text) return;

  // Parse flags
  // --dangerous = skip ALL permission prompts (dangerous mode)
  // --auto = auto-accept permissions (but still shows them briefly)
  const dangerous = text.includes('--dangerous') || text.includes('--yolo');
  const autoAccept = text.includes('--auto');
  text = text.replace(/--(dangerous|yolo|auto)/gi, '').trim();

  await react(channelId, msgTs, 'brain');

  let session = sessions.get(threadTs);

  if (!session) {
    const cfg = CHANNEL_CONFIG[channelName];
    const sessionName = `${cfg.prefix}-${Date.now().toString(36)}`;

    // Only spawn with dangerous flag if explicitly requested
    const ok = await spawnSession(sessionName, cfg.workingDir, dangerous);
    if (!ok) {
      await removeReact(channelId, msgTs, 'brain');
      await react(channelId, msgTs, 'x');
      return;
    }

    session = {
      sessionName,
      channelId,
      autoAccept: autoAccept || dangerous, // dangerous mode implies auto-accept
      dangerous
    };
    sessions.set(threadTs, session);
  }

  // Update flags if set on subsequent messages
  if (autoAccept) session.autoAccept = true;

  pendingResponses.set(session.sessionName, { channelId, threadTs, triggerTs: msgTs });
  sendText(session.sessionName, text);
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

  // Check for --auto flag in thread messages
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

// Cleanup hourly
setInterval(() => {
  for (const [ts, s] of sessions) {
    if (!tmuxExists(s.sessionName)) cleanup(s.sessionName, ts);
  }
}, 3600000);

(async () => {
  await app.start();
  console.log('Fufu v6 running');
  console.log('Channels:', Object.keys(CHANNEL_CONFIG).join(', '));
  console.log('');
  console.log('Modes:');
  console.log('  Default: normal (prompts for edit/bash, reply y/n)');
  console.log('  --auto: auto-accept all permissions');
  console.log('  --dangerous: skip all permission prompts');
})();
