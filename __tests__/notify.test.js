const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const NOTIFY = path.join(ROOT, "notify.js");
const QUEUE_FILE = path.join(ROOT, ".notification-queue.json");

function run(args) {
  return execSync(`node ${NOTIFY} ${args}`, {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();
}

function cleanQueue() {
  try { fs.unlinkSync(QUEUE_FILE); } catch {}
  try { fs.unlinkSync(QUEUE_FILE + ".tmp"); } catch {}
  try { fs.unlinkSync(QUEUE_FILE + ".lock"); } catch {}
}

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")); }
  catch { return []; }
}

beforeEach(cleanQueue);
afterAll(cleanQueue);

describe("notify.js CLI", () => {
  test("queues a notification with default values", () => {
    const output = run('"Hello world"');
    expect(output).toMatch(/Notification queued/);
    expect(output).toMatch(/Someone in #general: "Hello world"/);

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].message).toBe("Hello world");
    expect(queue[0].from).toBe("Someone");
    expect(queue[0].channel).toBe("#general");
  });

  test("queues with --from and --channel", () => {
    run('"Test msg" --from "Alice" --channel "#engineering"');

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].from).toBe("Alice");
    expect(queue[0].channel).toBe("#engineering");
    expect(queue[0].message).toBe("Test msg");
  });

  test("queues with --dm flag", () => {
    run('"Hey" --from "Bob" --dm');

    const queue = readQueue();
    expect(queue[0].channel).toBe("DM");
  });

  test("notification has no dead 'delivered' field", () => {
    run('"Clean msg"');

    const queue = readQueue();
    expect(queue[0]).not.toHaveProperty("delivered");
  });

  test("list shows pending notifications", () => {
    run('"msg1" --from "Alice"');
    run('"msg2" --from "Bob"');

    const output = run("list");
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
  });

  test("list shows empty message when no notifications", () => {
    const output = run("list");
    expect(output).toBe("No pending notifications.");
  });

  test("dismiss marks notification as dismissed", () => {
    run('"to dismiss" --from "Carol"');
    const queue = readQueue();
    const id = queue[0].id;

    run(`dismiss ${id}`);

    const updated = readQueue();
    expect(updated[0].dismissed).toBe(true);
  });

  test("dismiss hides from list", () => {
    run('"hidden" --from "Dave"');
    const queue = readQueue();
    const id = queue[0].id;

    run(`dismiss ${id}`);

    const output = run("list");
    expect(output).toBe("No pending notifications.");
  });

  test("snooze sets snoozedUntil and clears deliveredTo", () => {
    run('"snooze me" --from "Eve"');
    const queue = readQueue();
    const id = queue[0].id;

    // Simulate it having been delivered
    queue[0].deliveredTo = ["session-123"];
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue));

    run(`snooze ${id} 10`);

    const updated = readQueue();
    expect(updated[0].snoozedUntil).toBeGreaterThan(Date.now());
    expect(updated[0].deliveredTo).toEqual([]);
  });

  test("clear empties the queue", () => {
    run('"msg1"');
    run('"msg2"');
    expect(readQueue()).toHaveLength(2);

    run("clear");
    expect(readQueue()).toHaveLength(0);
  });

  test("no args shows usage and exits with error", () => {
    expect(() => run("")).toThrow();
  });
});
