#!/usr/bin/env node

// SessionStart hook: checks if the Slack listener is running.
// If not, auto-starts it in the background.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LISTENER_PATH = path.join(process.env.HOME, ".claude", "slack-notify", "slack-listener.js");
const PID_FILE = path.join(process.env.HOME, ".claude", "slack-notify", ".listener.pid");

function isRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    process.kill(pid, 0); // throws if process doesn't exist
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

  // Write the PID file for the spawned process
  try {
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch {}

  process.stdout.write("{}");
}
