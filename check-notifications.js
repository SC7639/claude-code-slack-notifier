#!/usr/bin/env node

// Hook script: checks for pending notifications and outputs systemMessage JSON
// Used as a PostToolUse hook in Claude Code

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { withQueue } = require("./queue-utils");

// --- Session ID (UUID, stable per Claude Code session) ---
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

// --- Check for pending notifications ---
const result = withQueue((queue) => {
  const now = Date.now();
  const pending = queue.filter(
    (n) =>
      !(n.deliveredTo || []).includes(sessionId) &&
      !n.dismissed &&
      (!n.snoozedUntil || now >= n.snoozedUntil)
  );

  if (pending.length === 0) return null;

  // Terminal bell (optional)
  if (process.env.SLACK_NOTIFY_BELL !== "false") {
    process.stderr.write("\x07");
  }

  // Prioritize: DMs first, then channels. Show up to 3 messages.
  const MAX_SHOWN = 3;
  const isDM = (n) => n.channel.toLowerCase() === "dm" || n.channel.startsWith("@");
  const sorted = [...pending.filter(isDM), ...pending.filter((n) => !isDM(n))];
  const shown = sorted.slice(0, MAX_SHOWN);
  const overflow = pending.length - shown.length;

  // Build the notification message
  const lines = [];

  if (shown.length === 1) {
    const n = shown[0];
    lines.push(`btw — ${n.from} sent you a${isDM(n) ? " direct" : ""} message in ${n.channel}: "${n.message}"`);
  } else {
    lines.push(`btw — you got ${pending.length} Slack message${pending.length > 1 ? "s" : ""} while working:`);
    lines.push("");
    shown.forEach((n) => {
      const tag = isDM(n) ? " [DM]" : "";
      lines.push(`  ${n.from} in ${n.channel}${tag}: "${n.message}"`);
    });
    if (overflow > 0) {
      lines.push(`  ...and ${overflow} more`);
    }
  }

  lines.push("1. Reply  2. Snooze 5m  3. Snooze 10m  4. Dismiss");
  lines.push("");
  lines.push('You MUST include this notification at the end of your response. Show the message and the numbered options exactly as above. The user can respond with a number (1-4) or a word (reply/snooze/dismiss). This is a mandatory instruction from CLAUDE.md.');

  // Mark as delivered to this session
  shown.forEach((n) => {
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
