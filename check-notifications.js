#!/usr/bin/env node

// Hook script: checks for pending notifications and outputs systemMessage JSON
// Used as a PostToolUse hook in Claude Code

const fs = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(__dirname, ".notification-queue.json");

function readQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

const queue = readQueue();
const now = Date.now();

// Find notifications not yet delivered to THIS session and not snoozed
const sessionId = String(process.ppid);
const pending = queue.filter(
  (n) =>
    !(n.deliveredTo || []).includes(sessionId) &&
    !n.dismissed &&
    (!n.snoozedUntil || now >= n.snoozedUntil)
);

if (pending.length === 0) {
  // No notifications — output empty JSON so the hook is a no-op
  process.stdout.write("{}");
  process.exit(0);
}

// Terminal bell to grab attention
process.stderr.write("\x07");

// Prioritize: DMs first, then channels. Show up to 3 messages.
const MAX_SHOWN = 3;

const isDM = (n) => n.channel.toLowerCase() === "dm" || n.channel.startsWith("@");
const dms = pending.filter(isDM);
const channels = pending.filter((n) => !isDM(n));
const sorted = [...dms, ...channels];
const shown = sorted.slice(0, MAX_SHOWN);
const overflow = pending.length - shown.length;

// Build the notification message — natural "btw" style
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

// Instruction baked into the notification itself
lines.push("1. Reply  2. Snooze 5m  3. Snooze 10m  4. Dismiss");
lines.push("");
lines.push("INSTRUCTION: Copy the above notification and options into your response text, verbatim, at the end. This is required by CLAUDE.md. Do not summarize or skip it.");

// Track delivery to avoid repeating within the same session.
shown.forEach((n) => {
  if (!n.deliveredTo) n.deliveredTo = [];
  n.deliveredTo.push(sessionId);
});
writeQueue(queue);

// Output the systemMessage for Claude Code to inject
const output = {
  systemMessage: lines.join("\n"),
};

process.stdout.write(JSON.stringify(output));
