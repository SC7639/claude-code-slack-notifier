#!/usr/bin/env bash
set -e

INSTALL_DIR="$HOME/.claude/slack-notify"
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

echo "Installing Slack notification system for Claude Code..."
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Write queue-utils.js
cat > "$INSTALL_DIR/queue-utils.js" << 'SCRIPT'
#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");

const QUEUE_FILE = path.join(__dirname, ".notification-queue.json");
const MAX_QUEUE_SIZE = 100;
const DISMISSED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ABSOLUTE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function readQueueRaw() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")); }
  catch { return []; }
}

function writeQueueAtomic(queue) {
  const tmp = QUEUE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2));
  fs.renameSync(tmp, QUEUE_FILE);
}

function pruneQueue(queue) {
  const now = Date.now();
  let pruned = queue.filter((n) => {
    const age = now - new Date(n.timestamp).getTime();
    if (age > ABSOLUTE_MAX_AGE_MS) return false;
    if (n.dismissed && age > DISMISSED_MAX_AGE_MS) return false;
    return true;
  });
  if (pruned.length > MAX_QUEUE_SIZE) pruned = pruned.slice(pruned.length - MAX_QUEUE_SIZE);
  return pruned;
}

function ensureQueueFile() {
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]");
}

function withQueue(callback) {
  ensureQueueFile();
  let release;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      release = lockfile.lockSync(QUEUE_FILE, { stale: 5000 });
      break;
    } catch (err) {
      if (err.code === "ELOCKED" && attempt < maxRetries) {
        const wait = 50 * Math.pow(2, attempt);
        const end = Date.now() + wait;
        while (Date.now() < end) {}
        continue;
      }
      throw err;
    }
  }
  try {
    const queue = readQueueRaw();
    const result = callback(queue);
    const updated = Array.isArray(result) ? result : queue;
    writeQueueAtomic(pruneQueue(updated));
    return result;
  } finally {
    if (release) release();
  }
}

function readQueue() {
  ensureQueueFile();
  return readQueueRaw();
}

function genId() { return Math.random().toString(36).slice(2, 8); }

module.exports = { withQueue, readQueue, genId, QUEUE_FILE };
SCRIPT

# Write the notification CLI
cat > "$INSTALL_DIR/notify.js" << 'SCRIPT'
#!/usr/bin/env node
const { withQueue, readQueue, genId } = require("./queue-utils");

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "list") {
  const q = readQueue().filter(n => !n.dismissed);
  if (!q.length) { console.log("No pending notifications."); process.exit(0); }
  q.forEach(n => {
    const s = n.snoozedUntil && Date.now() < n.snoozedUntil
      ? `(snoozed until ${new Date(n.snoozedUntil).toLocaleTimeString()})` : "(pending)";
    console.log(`  [${n.id}] ${s} ${n.from} in ${n.channel}: ${n.message}`);
  });
  process.exit(0);
}
if (cmd === "clear") { withQueue(() => []); console.log("Queue cleared."); process.exit(0); }
if (cmd === "snooze") {
  const id = args[1], min = parseInt(args[2] || "5", 10);
  withQueue((q) => {
    const item = q.find(n => n.id === id);
    if (!item) { console.error(`Notification ${id} not found.`); process.exit(1); }
    item.snoozedUntil = Date.now() + min * 60 * 1000;
    item.deliveredTo = [];
    return q;
  });
  console.log(`Snoozed for ${args[2] || 5} minutes.`);
  process.exit(0);
}
if (cmd === "dismiss") {
  const id = args[1];
  withQueue((q) => {
    const item = q.find(n => n.id === id);
    if (!item) { console.error(`Notification ${id} not found.`); process.exit(1); }
    item.dismissed = true;
    return q;
  });
  console.log(`Dismissed.`);
  process.exit(0);
}

if (!cmd || cmd.startsWith("-")) {
  console.error('Usage: slack-notify "message" --from "Name" --channel "#channel"');
  console.error('       slack-notify "message" --from "Name" --dm');
  console.error("       slack-notify list | clear | snooze <id> [min] | dismiss <id>");
  process.exit(1);
}

let from = "Someone", channel = "#general";
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--from" && args[i + 1]) from = args[++i];
  if (args[i] === "--channel" && args[i + 1]) channel = args[++i];
  if (args[i] === "--dm") channel = "DM";
}

const n = { id: genId(), from, channel, message: cmd, timestamp: new Date().toISOString(), snoozedUntil: null };
withQueue((q) => { q.push(n); return q; });
console.log(`[${n.id}] ${from} in ${channel}: "${cmd}"`);
SCRIPT

# Write the hook script
cat > "$INSTALL_DIR/check-notifications.js" << 'SCRIPT'
#!/usr/bin/env node
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { withQueue } = require("./queue-utils");

const SESSION_FILE = path.join(__dirname, `.session-${process.ppid}`);
const SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function getSessionId() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (Date.now() - data.created < SESSION_MAX_AGE_MS) return data.id;
  } catch {}
  const data = { id: crypto.randomUUID(), created: Date.now() };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data));
  return data.id;
}

const sessionId = getSessionId();

const result = withQueue((queue) => {
  const now = Date.now();
  const pending = queue.filter(n =>
    !(n.deliveredTo || []).includes(sessionId) &&
    !n.dismissed &&
    (!n.snoozedUntil || now >= n.snoozedUntil)
  );

  if (!pending.length) return null;

  if (process.env.SLACK_NOTIFY_BELL !== "false") process.stderr.write("\x07");

  const MAX = 3;
  const isDM = n => n.channel.toLowerCase() === "dm" || n.channel.startsWith("@");
  const sorted = [...pending.filter(isDM), ...pending.filter(n => !isDM(n))];
  const shown = sorted.slice(0, MAX);
  const overflow = pending.length - shown.length;

  const lines = [];
  if (shown.length === 1) {
    const n = shown[0];
    lines.push(`btw — ${n.from} sent you a${isDM(n) ? " direct" : ""} message in ${n.channel}: "${n.message}"`);
  } else {
    lines.push(`btw — you got ${pending.length} Slack message${pending.length > 1 ? "s" : ""} while working:`);
    lines.push("");
    shown.forEach(n => {
      lines.push(`  ${n.from} in ${n.channel}${isDM(n) ? " [DM]" : ""}: "${n.message}"`);
    });
    if (overflow > 0) lines.push(`  ...and ${overflow} more`);
  }

  lines.push("");
  lines.push("1. Reply  2. Snooze 5m  3. Snooze 10m  4. Dismiss");
  lines.push("");
  lines.push('You MUST include this notification at the end of your response. Show the message and the numbered options exactly as above. The user can respond with a number (1-4) or a word (reply/snooze/dismiss). This is a mandatory instruction from CLAUDE.md.');

  shown.forEach(n => {
    if (!n.deliveredTo) n.deliveredTo = [];
    n.deliveredTo.push(sessionId);
  });

  return { queue, lines };
});

if (!result) {
  process.stdout.write("{}");
} else {
  process.stdout.write(JSON.stringify({ systemMessage: result.lines.join("\n") }));
}
SCRIPT

chmod +x "$INSTALL_DIR/queue-utils.js" "$INSTALL_DIR/notify.js" "$INSTALL_DIR/check-notifications.js"

# Write the session start hook
cat > "$INSTALL_DIR/check-listener.js" << 'SCRIPT'
#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LISTENER_PATH = path.join(process.env.HOME, ".claude", "slack-notify", "slack-listener.js");
const PID_FILE = path.join(process.env.HOME, ".claude", "slack-notify", ".listener.pid");

function isRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (isRunning()) {
  process.stdout.write("{}");
  process.exit(0);
} else {
  const child = spawn("node", [LISTENER_PATH], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try { fs.writeFileSync(PID_FILE, String(child.pid)); } catch {}
  process.stdout.write("{}");
}
SCRIPT
chmod +x "$INSTALL_DIR/check-listener.js"

# --- Settings.json: add hooks ---
if [ ! -f "$SETTINGS_FILE" ]; then
  cat > "$SETTINGS_FILE" << SETTINGS
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node $INSTALL_DIR/check-notifications.js"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $INSTALL_DIR/check-listener.js"
          }
        ]
      }
    ]
  }
}
SETTINGS
  echo "[+] Created $SETTINGS_FILE"
else
  if grep -q "check-notifications" "$SETTINGS_FILE" 2>/dev/null; then
    echo "[=] Hook already in settings.json — updating path..."
    node -e "
      const fs = require('fs');
      const f = '$SETTINGS_FILE';
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const h of (s.hooks?.PostToolUse || [])) {
        for (const c of (h.hooks || [])) {
          if (c.command?.includes('check-notifications')) c.command = 'node $INSTALL_DIR/check-notifications.js';
        }
      }
      fs.writeFileSync(f, JSON.stringify(s, null, 2));
    "
  else
    echo "[+] Adding PostToolUse hook to settings.json..."
    node -e "
      const fs = require('fs');
      const f = '$SETTINGS_FILE';
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!s.hooks) s.hooks = {};
      if (!s.hooks.PostToolUse) s.hooks.PostToolUse = [];
      s.hooks.PostToolUse.push({ matcher: '', hooks: [{ type: 'command', command: 'node $INSTALL_DIR/check-notifications.js' }] });
      if (!s.hooks.SessionStart) s.hooks.SessionStart = [];
      s.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'node $INSTALL_DIR/check-listener.js' }] });
      fs.writeFileSync(f, JSON.stringify(s, null, 2));
    "
  fi
fi

# --- CLAUDE.md: add notification instruction ---
MARKER="CRITICAL INSTRUCTION — Slack notifications"
INSTRUCTION='CRITICAL INSTRUCTION — Slack notifications:

When a PostToolUse hook delivers a Slack notification via systemMessage (any message containing "btw —" and "Slack"), you MUST append it to the end of your response. This is NOT optional. Never skip it.

Format your note like this:

> btw, you got a Slack message from [name] in [channel]: "[message]"
> 1. Reply  2. Snooze 5m  3. Snooze 10m  4. Dismiss

Rules:
1. ALWAYS include the notification text at the END of your response
2. Include the sender name, channel, and message content
3. Show the numbered options (1-4) on a separate line
4. The user can respond with a number (1-4) or a word (reply, snooze, dismiss)
5. If there are multiple messages, list each one then show options once at the end
6. Do this EVERY time, even if the notification seems unimportant'

if [ ! -f "$CLAUDE_MD" ]; then
  echo "$INSTRUCTION" > "$CLAUDE_MD"
  echo "[+] Created $CLAUDE_MD"
elif grep -q "$MARKER" "$CLAUDE_MD"; then
  echo "[=] Instruction already in $CLAUDE_MD"
else
  printf "\n\n%s" "$INSTRUCTION" >> "$CLAUDE_MD"
  echo "[+] Appended instruction to $CLAUDE_MD"
fi

# --- Convenience wrapper ---
cat > "$INSTALL_DIR/slack" << ALIAS
#!/usr/bin/env bash
node "$INSTALL_DIR/notify.js" "\$@"
ALIAS
chmod +x "$INSTALL_DIR/slack"

# --- Copy Slack integration files ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/slack-listener.js" ]; then
  cp "$SCRIPT_DIR/slack-listener.js" "$INSTALL_DIR/slack-listener.js"
  cp "$SCRIPT_DIR/slack-reply.js" "$INSTALL_DIR/slack-reply.js"
  cp "$SCRIPT_DIR/queue-utils.js" "$INSTALL_DIR/queue-utils.js"
  chmod +x "$INSTALL_DIR/slack-listener.js" "$INSTALL_DIR/slack-reply.js"
  echo "[+] Copied Slack listener, reply, and queue-utils scripts"

  # Install dependencies
  cd "$INSTALL_DIR"
  if [ ! -d "node_modules/@slack" ] || [ ! -d "node_modules/proper-lockfile" ]; then
    echo "[+] Installing dependencies..."
    npm init -y --silent > /dev/null 2>&1
    npm install --save @slack/web-api @slack/socket-mode proper-lockfile --silent 2>/dev/null
  fi
  cd "$SCRIPT_DIR"
fi

# --- Shell alias suggestion ---
echo ""
echo "Done! Restart Claude Code to activate."
echo ""
echo "=== Test mode (fake notifications) ==="
echo "  ~/.claude/slack-notify/slack \"Hey!\" --from \"Alice\" --dm"
echo "  ~/.claude/slack-notify/slack list"
echo ""
echo "=== Real Slack mode ==="
echo "  1. Set env vars (add to ~/.zshrc or ~/.bashrc):"
echo "     export SLACK_APP_TOKEN=xapp-..."
echo "     export SLACK_USER_TOKEN=xoxp-..."
echo ""
echo "  2. Start the listener (run in a background terminal):"
echo "     node ~/.claude/slack-notify/slack-listener.js"
echo ""
echo "  3. Use Claude Code normally — DMs and @mentions will appear!"
echo ""
echo "Optional alias — add to your shell profile:"
echo "  alias slack-notify='$HOME/.claude/slack-notify/slack'"
