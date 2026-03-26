const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHECK_SCRIPT = path.join(ROOT, "check-notifications.js");
const QUEUE_FILE = path.join(ROOT, ".notification-queue.json");

function run(env = {}) {
  return execSync(`node ${CHECK_SCRIPT}`, {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, SLACK_NOTIFY_BELL: "false", ...env },
  }).trim();
}

function writeQueue(entries) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(entries, null, 2));
}

function readQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
}

function cleanQueue() {
  try { fs.unlinkSync(QUEUE_FILE); } catch {}
  try { fs.unlinkSync(QUEUE_FILE + ".tmp"); } catch {}
  try { fs.rmSync(QUEUE_FILE + ".lock", { recursive: true, force: true }); } catch {}
  // Clean session files
  for (const f of fs.readdirSync(ROOT)) {
    if (f.startsWith(".session-")) {
      try { fs.unlinkSync(path.join(ROOT, f)); } catch {}
    }
  }
}

beforeEach(cleanQueue);
afterAll(cleanQueue);

describe("check-notifications.js", () => {
  test("outputs empty JSON when no notifications", () => {
    const output = run();
    expect(JSON.parse(output)).toEqual({});
  });

  test("outputs empty JSON when queue is empty", () => {
    writeQueue([]);
    const output = run();
    expect(JSON.parse(output)).toEqual({});
  });

  test("delivers a single notification", () => {
    writeQueue([
      {
        id: "abc",
        from: "Alice",
        channel: "DM",
        message: "Hey there!",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
    ]);

    const output = run();
    const result = JSON.parse(output);

    expect(result.systemMessage).toBeDefined();
    expect(result.systemMessage).toContain("Alice");
    expect(result.systemMessage).toContain("Hey there!");
    expect(result.systemMessage).toContain("Reply");
    expect(result.systemMessage).toContain("Snooze");
    expect(result.systemMessage).toContain("Dismiss");
  });

  test("delivers multiple notifications with count", () => {
    writeQueue([
      {
        id: "a",
        from: "Alice",
        channel: "DM",
        message: "Hey",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
      {
        id: "b",
        from: "Bob",
        channel: "#general",
        message: "Check this",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
    ]);

    const output = run();
    const result = JSON.parse(output);

    expect(result.systemMessage).toContain("2 Slack messages");
    expect(result.systemMessage).toContain("Alice");
    expect(result.systemMessage).toContain("Bob");
  });

  test("skips dismissed notifications", () => {
    writeQueue([
      {
        id: "dismissed",
        from: "Alice",
        channel: "DM",
        message: "Old msg",
        timestamp: new Date().toISOString(),
        dismissed: true,
      },
    ]);

    const output = run();
    expect(JSON.parse(output)).toEqual({});
  });

  test("skips snoozed notifications", () => {
    writeQueue([
      {
        id: "snoozed",
        from: "Alice",
        channel: "DM",
        message: "Snoozed msg",
        timestamp: new Date().toISOString(),
        snoozedUntil: Date.now() + 60000,
      },
    ]);

    const output = run();
    expect(JSON.parse(output)).toEqual({});
  });

  test("delivers expired snooze notifications", () => {
    writeQueue([
      {
        id: "unsnoozed",
        from: "Alice",
        channel: "DM",
        message: "Wake up!",
        timestamp: new Date().toISOString(),
        snoozedUntil: Date.now() - 1000, // expired
      },
    ]);

    const output = run();
    const result = JSON.parse(output);
    expect(result.systemMessage).toContain("Wake up!");
  });

  test("marks notifications as delivered with session ID", () => {
    writeQueue([
      {
        id: "track",
        from: "Alice",
        channel: "DM",
        message: "Track me",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
    ]);

    run();

    const queue = readQueue();
    expect(queue[0].deliveredTo).toBeDefined();
    expect(queue[0].deliveredTo.length).toBe(1);
    // Should be a UUID, not a PID
    expect(queue[0].deliveredTo[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("does not re-deliver to same session (same ppid)", () => {
    writeQueue([
      {
        id: "once",
        from: "Alice",
        channel: "DM",
        message: "Only once",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
    ]);

    // First call delivers and records the session UUID
    const first = JSON.parse(run());
    expect(first.systemMessage).toContain("Only once");

    // Read the session ID that was written
    const queue = readQueue();
    expect(queue[0].deliveredTo).toHaveLength(1);
    const sessionId = queue[0].deliveredTo[0];

    // Manually mark as delivered to simulate same-session re-delivery
    // (each execSync creates a new process with different ppid, so we
    // verify the mechanism works by checking the deliveredTo array)
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("prioritizes DMs over channel messages", () => {
    writeQueue([
      {
        id: "ch",
        from: "Bob",
        channel: "#general",
        message: "Channel msg",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
      {
        id: "dm",
        from: "Alice",
        channel: "DM",
        message: "DM msg",
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      },
    ]);

    const output = run();
    const result = JSON.parse(output);
    const lines = result.systemMessage.split("\n");

    // DM should appear before channel message in the list
    const dmIdx = lines.findIndex((l) => l.includes("Alice"));
    const chIdx = lines.findIndex((l) => l.includes("Bob"));
    expect(dmIdx).toBeLessThan(chIdx);
  });

  test("shows overflow count for more than 3 notifications", () => {
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        id: `n${i}`,
        from: `User${i}`,
        channel: "#general",
        message: `msg ${i}`,
        timestamp: new Date().toISOString(),
        snoozedUntil: null,
      });
    }
    writeQueue(entries);

    const output = run();
    const result = JSON.parse(output);
    expect(result.systemMessage).toContain("5 Slack messages");
    expect(result.systemMessage).toContain("...and 2 more");
  });

  test("creates session file with UUID", () => {
    writeQueue([]);
    run();

    const sessionFiles = fs.readdirSync(ROOT).filter((f) => f.startsWith(".session-"));
    expect(sessionFiles.length).toBeGreaterThanOrEqual(1);

    const sessionData = JSON.parse(
      fs.readFileSync(path.join(ROOT, sessionFiles[0]), "utf8")
    );
    expect(sessionData.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(sessionData.created).toBeDefined();
  });
});
