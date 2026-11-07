// File helpers that are safe when two sessions or a crash get in the way.
import fs from "node:fs";
import path from "node:path";

// Write via a temp file and rename, so a crash never leaves half a document.
export function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Cross-process lock using an atomic mkdir. A lock older than `staleMs` belonged
// to a crashed process and is taken over.
export function withLock(lockDir, fn, { waitMs = 5000, staleMs = 15000 } = {}) {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const start = Date.now();
  let last = null;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (e) {
      // Windows reports EPERM/EACCES/EBUSY, not EEXIST, while another process is deleting the lock directory.
      if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      last = e;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > staleMs) fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // released between our checks
      }
      if (Date.now() - start > waitMs) throw new Error(`timed out waiting for lock ${lockDir}${last && last.code !== "EEXIST" ? ` (${last.code})` : ""}`);
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}
