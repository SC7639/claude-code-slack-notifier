#!/usr/bin/env node

// Shared queue utilities with file locking and auto-pruning.
// All queue access should go through this module to prevent race conditions.

const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");

const QUEUE_FILE = path.join(__dirname, ".notification-queue.json");
const MAX_QUEUE_SIZE = 100;
const DISMISSED_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const ABSOLUTE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

function readQueueRaw() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
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
  if (pruned.length > MAX_QUEUE_SIZE) {
    pruned = pruned.slice(pruned.length - MAX_QUEUE_SIZE);
  }
  return pruned;
}

// Ensure the queue file exists before locking
function ensureQueueFile() {
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, "[]");
  }
}

// Read-modify-write the queue under a lock.
// callback receives the queue array and should return the modified queue.
function withQueue(callback) {
  ensureQueueFile();
  let release;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      release = lockfile.lockSync(QUEUE_FILE, { stale: 5000 });
      break;
    } catch (err) {
      if ((err.code === "ELOCKED" || err.code === "ENOENT") && attempt < maxRetries) {
        ensureQueueFile();
        const wait = 50 * Math.pow(2, attempt);
        const end = Date.now() + wait;
        while (Date.now() < end) {} // busy-wait (sync context)
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

// Read-only access (no lock needed thanks to atomic writes)
function readQueue() {
  ensureQueueFile();
  return readQueueRaw();
}

function genId() {
  return Math.random().toString(36).slice(2, 8);
}

module.exports = { withQueue, readQueue, genId, QUEUE_FILE };
