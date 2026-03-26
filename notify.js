#!/usr/bin/env node

// CLI to simulate incoming Slack messages
// Usage: node notify.js "message" --from "Alice" --channel "#general"
//        node notify.js snooze <id> <minutes>
//        node notify.js list
//        node notify.js clear

const { withQueue, readQueue, genId } = require("./queue-utils");

const args = process.argv.slice(2);
const command = args[0];

if (command === "list") {
  const queue = readQueue().filter((n) => !n.dismissed);
  if (queue.length === 0) {
    console.log("No pending notifications.");
  } else {
    queue.forEach((n) => {
      const snoozed = n.snoozedUntil && Date.now() < n.snoozedUntil;
      const status = snoozed
        ? `(snoozed until ${new Date(n.snoozedUntil).toLocaleTimeString()})`
        : "(pending)";
      console.log(
        `  [${n.id}] ${status} ${n.from} in ${n.channel}: ${n.message}`
      );
    });
  }
  process.exit(0);
}

if (command === "clear") {
  withQueue(() => []);
  console.log("Queue cleared.");
  process.exit(0);
}

if (command === "snooze") {
  const id = args[1];
  const minutes = parseInt(args[2] || "5", 10);
  withQueue((queue) => {
    const item = queue.find((n) => n.id === id);
    if (!item) {
      console.error(`Notification ${id} not found.`);
      process.exit(1);
    }
    item.snoozedUntil = Date.now() + minutes * 60 * 1000;
    item.deliveredTo = [];
    console.log(`Snoozed ${id} for ${minutes} minutes.`);
    return queue;
  });
  process.exit(0);
}

if (command === "dismiss") {
  const id = args[1];
  withQueue((queue) => {
    const item = queue.find((n) => n.id === id);
    if (!item) {
      console.error(`Notification ${id} not found.`);
      process.exit(1);
    }
    item.dismissed = true;
    console.log(`Dismissed ${id}.`);
    return queue;
  });
  process.exit(0);
}

// Default: send a new notification
if (!command || command.startsWith("-")) {
  console.error(
    'Usage: node notify.js "message" --from "Name" --channel "#channel"'
  );
  process.exit(1);
}

const message = command;
let from = "Someone";
let channel = "#general";

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--from" && args[i + 1]) from = args[++i];
  if (args[i] === "--channel" && args[i + 1]) channel = args[++i];
  if (args[i] === "--dm") channel = "DM";
}

const notification = {
  id: genId(),
  from,
  channel,
  message,
  timestamp: new Date().toISOString(),
  snoozedUntil: null,
};

withQueue((queue) => {
  queue.push(notification);
  return queue;
});

console.log(`Notification queued [${notification.id}]: ${from} in ${channel}: "${message}"`);
