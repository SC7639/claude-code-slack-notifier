#!/usr/bin/env node

// Send a reply to a Slack channel/DM.
// Used by Claude Code to respond to notifications.
//
// Usage: node slack-reply.js --channel "#general" --message "On it!"
//        node slack-reply.js --channel "DM" --user "Alice" --message "Sure, 5 min"

require("dotenv").config({ path: __dirname + "/.env" });
const { WebClient } = require("@slack/web-api");

const USER_TOKEN = process.env.SLACK_USER_TOKEN;
if (!USER_TOKEN) {
  console.error("SLACK_USER_TOKEN not set");
  process.exit(1);
}

const web = new WebClient(USER_TOKEN);
const args = process.argv.slice(2);

let channel = null;
let user = null;
let message = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--channel" && args[i + 1]) channel = args[++i];
  if (args[i] === "--user" && args[i + 1]) user = args[++i];
  if (args[i] === "--message" && args[i + 1]) message = args[++i];
}

if (!message) {
  console.error('Usage: node slack-reply.js --channel "#general" --message "text"');
  console.error('       node slack-reply.js --user "Alice" --message "text"');
  process.exit(1);
}

async function findChannel() {
  // If it's a DM, find the DM channel by user name
  if (channel === "DM" || (!channel && user)) {
    // List users to find the target
    const userList = await web.users.list();
    const target = userList.members.find(
      (m) =>
        m.profile.display_name?.toLowerCase() === user?.toLowerCase() ||
        m.real_name?.toLowerCase() === user?.toLowerCase() ||
        m.name?.toLowerCase() === user?.toLowerCase()
    );
    if (!target) {
      console.error(`User "${user}" not found`);
      process.exit(1);
    }
    // Open DM
    const dm = await web.conversations.open({ users: target.id });
    return dm.channel.id;
  }

  // Channel name (strip #)
  const name = channel.replace(/^#/, "");
  const list = await web.conversations.list({ types: "public_channel,private_channel", limit: 200 });
  const ch = list.channels.find((c) => c.name === name);
  if (!ch) {
    console.error(`Channel "${channel}" not found`);
    process.exit(1);
  }
  return ch.id;
}

async function send() {
  const channelId = await findChannel();
  await web.chat.postMessage({ channel: channelId, text: message });
  console.log(`Sent to ${channel || user}: "${message}"`);
}

send().catch((err) => {
  console.error("Failed to send:", err.message);
  process.exit(1);
});
