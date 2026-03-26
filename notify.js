#!/usr/bin/env node

// CLI to simulate incoming Slack messages
// Usage: node notify.js "message" --from "Alice" --channel "#general"
//        node notify.js snooze <id> <minutes>
//        node notify.js list
//        node notify.js clear

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

function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

const args = process.argv.slice(2);
const command = args[0];

if (command === "list") {
  const queue = readQueue();
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
  writeQueue([]);
  console.log("Queue cleared.");
  process.exit(0);
}

if (command === "snooze") {
  const id = args[1];
  const minutes = parseInt(args[2] || "5", 10);
  const queue = readQueue();
  const item = queue.find((n) => n.id === id);
  if (!item) {
    console.error(`Notification ${id} not found.`);
    process.exit(1);
  }
  item.snoozedUntil = Date.now() + minutes * 60 * 1000;
  item.delivered = false;
  writeQueue(queue);
  console.log(`Snoozed ${id} for ${minutes} minutes.`);
  process.exit(0);
}

if (command === "dismiss") {
  const id = args[1];
  const queue = readQueue();
  const item = queue.find((n) => n.id === id);
  if (!item) {
    console.error(`Notification ${id} not found.`);
    process.exit(1);
  }
  item.dismissed = true;
  writeQueue(queue);
  console.log(`Dismissed ${id}.`);
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

const queue = readQueue();
const notification = {
  id: generateId(),
  from,
  channel,
  message,
  timestamp: new Date().toISOString(),
  delivered: false,
  snoozedUntil: null,
};
queue.push(notification);
writeQueue(queue);

console.log(`Notification queued [${notification.id}]: ${from} in ${channel}: "${message}"`);
