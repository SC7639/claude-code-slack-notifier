#!/usr/bin/env node

// Slack real-time listener — connects via Socket Mode, watches for
// messages directed at you (DMs, mentions, channels you're in),
// and queues them as notifications for the Claude Code hook.

require("dotenv").config({ path: __dirname + "/.env" });
const { WebClient } = require("@slack/web-api");
const { SocketModeClient } = require("@slack/socket-mode");
const fs = require("fs");
const path = require("path");
const { withQueue, genId } = require("./queue-utils");

// --- Config ---
const APP_TOKEN = process.env.SLACK_APP_TOKEN;   // xapp-...
const USER_TOKEN = process.env.SLACK_USER_TOKEN;  // xoxp-...

if (!APP_TOKEN || !USER_TOKEN) {
  console.error("Missing env vars. Set SLACK_APP_TOKEN (xapp-...) and SLACK_USER_TOKEN (xoxp-...)");
  console.error("");
  console.error("  export SLACK_APP_TOKEN=xapp-...");
  console.error("  export SLACK_USER_TOKEN=xoxp-...");
  console.error("  node slack-listener.js");
  process.exit(1);
}

const PID_FILE = path.join(__dirname, ".listener.pid");
const web = new WebClient(USER_TOKEN);
const socket = new SocketModeClient({ appToken: APP_TOKEN });

// Cache: user IDs -> display names, channel IDs -> names
const userCache = {};
const channelCache = {};
let myUserId = null;

function queueNotification(from, channel, message) {
  withQueue((q) => {
    q.push({
      id: genId(),
      from,
      channel,
      message,
      timestamp: new Date().toISOString(),
      snoozedUntil: null,
    });
    return q;
  });
  console.log(`[${new Date().toLocaleTimeString()}] ${from} in ${channel}: ${message}`);
}

// --- Resolve Slack IDs to human names ---
async function getUserName(userId) {
  if (userCache[userId]) return userCache[userId];
  try {
    const res = await web.users.info({ user: userId });
    const name = res.user.profile.display_name || res.user.real_name || res.user.name;
    userCache[userId] = name;
    return name;
  } catch {
    return userId;
  }
}

async function getChannelInfo(channelId) {
  if (channelCache[channelId]) return channelCache[channelId];
  try {
    const res = await web.conversations.info({ channel: channelId });
    const ch = res.channel;
    const isDM = ch.is_im || false;
    const name = isDM ? "DM" : `#${ch.name}`;
    channelCache[channelId] = { name, isDM };
    return { name, isDM };
  } catch {
    return { name: channelId, isDM: false };
  }
}

// --- Replace <@U123> mentions with names ---
async function resolveText(text) {
  if (!text) return "";
  const mentions = text.match(/<@(U[A-Z0-9]+)>/g) || [];
  let resolved = text;
  for (const mention of mentions) {
    const uid = mention.slice(2, -1);
    const name = await getUserName(uid);
    resolved = resolved.replace(mention, `@${name}`);
  }
  return resolved;
}

// --- PID file management ---
function writePidFile() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

// --- Main ---
async function start() {
  // Get our own user ID so we can filter out our own messages
  const authRes = await web.auth.test();
  myUserId = authRes.user_id;
  console.log(`Logged in as ${authRes.user} (${myUserId})`);
  console.log("Listening for Slack messages...");
  console.log("Press Ctrl+C to stop.\n");

  socket.on("message", async ({ event, ack }) => {
    await ack();

    // Skip our own messages, bot messages, and message edits/deletes
    if (!event || event.user === myUserId) return;
    if (event.subtype && event.subtype !== "file_share") return;
    if (!event.text && !event.files) return;

    const [userName, channelInfo, messageText] = await Promise.all([
      getUserName(event.user),
      getChannelInfo(event.channel),
      resolveText(event.text || "(shared a file)"),
    ]);

    // For non-DM channels, only notify if we're mentioned
    if (!channelInfo.isDM && !event.text?.includes(`<@${myUserId}>`)) {
      return;
    }

    queueNotification(userName, channelInfo.name, messageText);
  });

  await socket.start();
  writePidFile();
}

start().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});

// Graceful shutdown
function shutdown() {
  console.log("\nStopping listener...");
  removePidFile();
  socket.disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
