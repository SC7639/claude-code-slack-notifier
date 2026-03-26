#!/usr/bin/env bash
set -e

INSTALL_DIR="$HOME/.claude/slack-notify"
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

echo "Installing Slack notification system for Claude Code..."
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Write the notification CLI
cat > "$INSTALL_DIR/notify.js" << 'SCRIPT'
#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const QUEUE_FILE = path.join(__dirname, ".notification-queue.json");

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")); }
  catch { return []; }
}
function writeQueue(q) { fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); }
function genId() { return Math.random().toString(36).slice(2, 8); }

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
if (cmd === "clear") { writeQueue([]); console.log("Queue cleared."); process.exit(0); }
if (cmd === "snooze") {
  const id = args[1], min = parseInt(args[2] || "5", 10), q = readQueue();
  const item = q.find(n => n.id === id);
  if (!item) { console.error(`Notification ${id} not found.`); process.exit(1); }
  item.snoozedUntil = Date.now() + min * 60 * 1000;
  item.deliveredTo = [];
  writeQueue(q);
  console.log(`Snoozed ${id} for ${min} minutes.`);
  process.exit(0);
}
if (cmd === "dismiss") {
  const id = args[1], q = readQueue();
  const item = q.find(n => n.id === id);
  if (!item) { console.error(`Notification ${id} not found.`); process.exit(1); }
  item.dismissed = true;
  writeQueue(q);
  console.log(`Dismissed ${id}.`);
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

const q = readQueue();
const n = { id: genId(), from, channel, message: cmd, timestamp: new Date().toISOString(), delivered: false, snoozedUntil: null };
q.push(n);
writeQueue(q);
console.log(`[${n.id}] ${from} in ${channel}: "${cmd}"`);
SCRIPT

# Write the hook script
cat > "$INSTALL_DIR/check-notifications.js" << 'SCRIPT'
#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const QUEUE_FILE = path.join(__dirname, ".notification-queue.json");

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")); }
  catch { return []; }
}
function writeQueue(q) { fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); }

const queue = readQueue();
const now = Date.now();
const sid = String(process.ppid);

const pending = queue.filter(n =>
  !(n.deliveredTo || []).includes(sid) &&
  !n.dismissed &&
  (!n.snoozedUntil || now >= n.snoozedUntil)
);

if (!pending.length) { process.stdout.write("{}"); process.exit(0); }

process.stderr.write("\x07");

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
  n.deliveredTo.push(sid);
});
writeQueue(queue);

process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));
SCRIPT

chmod +x "$INSTALL_DIR/notify.js" "$INSTALL_DIR/check-notifications.js"

# Write the session start hook
cat > "$INSTALL_DIR/check-listener.js" << 'SCRIPT'
#!/usr/bin/env node
const { execSync } = require("child_process");
try {
  const procs = execSync("pgrep -f slack-listener.js 2>/dev/null", { encoding: "utf8" }).trim();
  if (procs) { process.stdout.write("{}"); }
  else { throw new Error("not running"); }
} catch {
  process.stdout.write(JSON.stringify({
    systemMessage: "The Slack notification listener is not running. Ask the user: \"Want me to start the Slack listener? (yes/no)\" — If they say yes, run: node " + process.env.HOME + "/.claude/slack-notify/slack-listener.js in the background using Bash with run_in_background."
  }));
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
  chmod +x "$INSTALL_DIR/slack-listener.js" "$INSTALL_DIR/slack-reply.js"
  echo "[+] Copied Slack listener and reply scripts"

  # Install Slack dependencies
  cd "$INSTALL_DIR"
  if [ ! -d "node_modules/@slack" ]; then
    echo "[+] Installing Slack SDK..."
    npm init -y --silent > /dev/null 2>&1
    npm install --save @slack/web-api @slack/socket-mode --silent 2>/dev/null
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
