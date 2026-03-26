#!/usr/bin/env node

// SessionStart hook: checks if the Slack listener is running.
// If not, auto-starts it in the background.

const { execSync, spawn } = require("child_process");
const path = require("path");

const LISTENER_PATH = path.join(process.env.HOME, ".claude", "slack-notify", "slack-listener.js");

function isRunning() {
  try {
    const procs = execSync("pgrep -f slack-listener.js 2>/dev/null", { encoding: "utf8" }).trim();
    return procs.length > 0;
  } catch {
    return false;
  }
}

if (isRunning()) {
  process.stdout.write("Slack notification listener is running.");
  process.exit(0);
} else {
  const child = spawn("node", [LISTENER_PATH], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  process.stdout.write("Slack notification listener was not running — started it automatically (PID " + child.pid + ").");
}
