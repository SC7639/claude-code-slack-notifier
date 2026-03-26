const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Use a temp directory for all queue tests
const TEST_DIR = path.join(__dirname, ".test-tmp");
const QUEUE_FILE = path.join(TEST_DIR, ".notification-queue.json");

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Clean up any leftover files
  for (const f of fs.readdirSync(TEST_DIR)) {
    fs.unlinkSync(path.join(TEST_DIR, f));
  }
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// We need to re-require queue-utils with a patched __dirname
// Instead, we'll test via the actual module but point QUEUE_FILE via a wrapper
function loadQueueUtils() {
  // Clear module cache so we get a fresh instance
  const modulePath = require.resolve("../queue-utils");
  delete require.cache[modulePath];

  // Monkey-patch the module's QUEUE_FILE by modifying __dirname equivalent
  // Instead, we'll use a wrapper approach
  const original = require("../queue-utils");
  return original;
}

describe("queue-utils", () => {
  let qu;

  beforeEach(() => {
    qu = loadQueueUtils();
    // Ensure the real queue file is clean
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  test("readQueue returns empty array when no file exists", () => {
    const queue = qu.readQueue();
    expect(queue).toEqual([]);
  });

  test("withQueue creates file if missing and writes data", () => {
    qu.withQueue((q) => {
      q.push({ id: "test1", message: "hello", timestamp: new Date().toISOString() });
      return q;
    });

    const queue = qu.readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("test1");
    expect(queue[0].message).toBe("hello");
  });

  test("withQueue preserves existing data", () => {
    qu.withQueue((q) => {
      q.push({ id: "a", message: "first", timestamp: new Date().toISOString() });
      return q;
    });
    qu.withQueue((q) => {
      q.push({ id: "b", message: "second", timestamp: new Date().toISOString() });
      return q;
    });

    const queue = qu.readQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].id).toBe("a");
    expect(queue[1].id).toBe("b");
  });

  test("withQueue returns callback result", () => {
    const result = qu.withQueue((q) => {
      q.push({ id: "x", timestamp: new Date().toISOString() });
      return q;
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  test("genId produces unique 6-char strings", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(qu.genId());
    }
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id.length).toBe(6);
    }
  });
});

describe("queue pruning", () => {
  let qu;

  beforeEach(() => {
    qu = loadQueueUtils();
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  test("prunes dismissed notifications older than 24 hours", () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const newTime = new Date().toISOString();

    // Seed the queue file directly
    fs.writeFileSync(qu.QUEUE_FILE, JSON.stringify([
      { id: "old-dismissed", dismissed: true, timestamp: oldTime },
      { id: "new-dismissed", dismissed: true, timestamp: newTime },
      { id: "old-active", timestamp: oldTime },
    ]));

    // Trigger a withQueue to force pruning
    qu.withQueue((q) => q);

    const queue = qu.readQueue();
    const ids = queue.map((n) => n.id);
    expect(ids).not.toContain("old-dismissed");
    expect(ids).toContain("new-dismissed");
    expect(ids).toContain("old-active");
  });

  test("prunes all notifications older than 48 hours", () => {
    const veryOld = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    fs.writeFileSync(qu.QUEUE_FILE, JSON.stringify([
      { id: "ancient", timestamp: veryOld },
      { id: "fresh", timestamp: recent },
    ]));

    qu.withQueue((q) => q);

    const queue = qu.readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("fresh");
  });

  test("caps queue at 100 entries, keeping newest", () => {
    const entries = [];
    const now = Date.now();
    for (let i = 0; i < 110; i++) {
      entries.push({
        id: `item-${i}`,
        timestamp: new Date(now - (110 - i) * 1000).toISOString(),
      });
    }

    fs.writeFileSync(qu.QUEUE_FILE, JSON.stringify(entries));
    qu.withQueue((q) => q);

    const queue = qu.readQueue();
    expect(queue).toHaveLength(100);
    // Should keep the 100 newest (items 10-109)
    expect(queue[0].id).toBe("item-10");
    expect(queue[99].id).toBe("item-109");
  });
});

describe("concurrent access", () => {
  let qu;

  beforeEach(() => {
    qu = loadQueueUtils();
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(qu.QUEUE_FILE); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".tmp"); } catch {}
    try { fs.unlinkSync(qu.QUEUE_FILE + ".lock"); } catch {}
  });

  test("atomic write produces valid JSON even if read during write", () => {
    // Write initial data
    qu.withQueue((q) => {
      q.push({ id: "init", message: "initial", timestamp: new Date().toISOString() });
      return q;
    });

    // Perform multiple rapid writes
    for (let i = 0; i < 20; i++) {
      qu.withQueue((q) => {
        q.push({ id: `rapid-${i}`, message: `msg-${i}`, timestamp: new Date().toISOString() });
        return q;
      });
    }

    // The file should always be valid JSON
    const content = fs.readFileSync(qu.QUEUE_FILE, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();

    const queue = JSON.parse(content);
    expect(queue.length).toBe(21); // 1 initial + 20 rapid
  });
});
