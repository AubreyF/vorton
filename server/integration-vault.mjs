import path from "node:path";
import { constants } from "node:fs";
import { open, lstat, link, unlink } from "node:fs/promises";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { safeDirectory, check, Fault } from "./store.mjs";

const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const missing = error => error?.code === "ENOENT";

async function exists(filename) {
  try {
    const info = await lstat(filename);
    check(info.isFile() && !info.isSymbolicLink(), "Invalid integration storage", 503);
    check((info.mode & 0o077) === 0, "Integration storage must be private", 503);
    return true;
  } catch (error) { if (missing(error)) return false; throw error; }
}

/** Atomic key publication prevents another process observing a partially written key. */
async function createKey(filename) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(randomBytes(32));
    await file.sync();
  } finally { await file.close(); }
  try {
    try { await link(temporary, filename); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const directory = await open(path.dirname(filename), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary); }
}

/**
 * One-owner encrypted integration storage. SQLite supplies crash-safe transactions;
 * AES-GCM binds every value to its workspace, module and record identity.
 * This does not isolate processes sharing the owner's OS account. The master key
 * is deliberately outside the database and must be recovered separately.
 */
export class IntegrationVault {
  constructor(root, profiles, { keyFile = process.env.VORTON_INTEGRATION_KEY_FILE, onRead = () => {} } = {}) {
    check(Array.isArray(profiles) && profiles.length > 0 && profiles.every(p => identifier.test(p)), "Invalid integration profiles");
    this.profiles = new Set(profiles);
    this.onRead = onRead;
    this.root = path.resolve(root);
    this.runtime = path.join(this.root, ".runtime");
    this.directory = path.join(this.runtime, "integrations");
    this.filename = path.join(this.directory, "vault.sqlite");
    this.externalKey = Boolean(keyFile);
    this.keyFile = keyFile ? path.resolve(keyFile) : path.join(this.runtime, "secrets", "integrations.key");
  }

  async run(profile, module, callback, { create = false } = {}) {
    check(this.profiles.has(profile), "Unknown installation", 404);
    check(identifier.test(module), "Invalid integration module");
    let db, key;
    try {
      // Inspect each parent rather than trusting recursive mkdir through a symlink.
      for (const directory of [this.root, this.runtime, this.directory]) {
        if (!create) {
          try { const s = await lstat(directory); check(s.isDirectory() && !s.isSymbolicLink(), "Invalid integration directory", 503); }
          catch (error) { if (missing(error)) return null; throw error; }
        } else await safeDirectory(directory);
      }
      const present = await exists(this.filename);
      if (!present && !create) return null;
      if (!this.externalKey) await safeDirectory(path.dirname(this.keyFile));
      if (!(await exists(this.keyFile))) {
        // Never silently replace a lost key: it would make retained records unreadable.
        check(!present && !this.externalKey && create, "Integration encryption key unavailable. Restore the original key.", 503);
        await createKey(this.keyFile);
      }
      const keyHandle = await open(this.keyFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { key = await keyHandle.readFile(); } finally { await keyHandle.close(); }
      check(key.length === 32, "Invalid integration encryption key", 503);
      if (!present) {
        try { const file = await open(this.filename, "wx", 0o600); await file.close(); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
      }
      check(await exists(this.filename), "Integration database unavailable", 503);
      db = new DatabaseSync(this.filename);
      db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;");
      db.exec("CREATE TABLE IF NOT EXISTS records (profile TEXT NOT NULL, module TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(profile,module,id))");
      // Only keyed day equality, pending state and ingestion order are exposed.
      // Recording times, content hashes and sizes stay in encrypted metadata.
      db.exec(`CREATE TABLE IF NOT EXISTS record_index (
        position INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL, module TEXT NOT NULL,
        id TEXT NOT NULL, day_token TEXT NOT NULL, pending INTEGER NOT NULL,
        UNIQUE(profile,module,id));
        CREATE INDEX IF NOT EXISTS record_index_day ON record_index(profile,module,day_token,position);
        CREATE INDEX IF NOT EXISTS record_index_pending ON record_index(profile,module,pending,position);
        CREATE INDEX IF NOT EXISTS record_index_order ON record_index(profile,module,position);
        CREATE TABLE IF NOT EXISTS index_counts (profile TEXT NOT NULL,module TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0,generation INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(profile,module));
        CREATE TABLE IF NOT EXISTS index_dirty (profile TEXT NOT NULL,module TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(profile,module,id));
        CREATE TRIGGER IF NOT EXISTS record_dirty_insert AFTER INSERT ON records WHEN substr(NEW.id,1,13)='conversation:' BEGIN
          INSERT OR IGNORE INTO index_dirty VALUES(NEW.profile,NEW.module,NEW.id);
        END;
        CREATE TRIGGER IF NOT EXISTS record_dirty_update AFTER UPDATE ON records WHEN substr(NEW.id,1,13)='conversation:' BEGIN
          INSERT OR IGNORE INTO index_dirty VALUES(NEW.profile,NEW.module,NEW.id);
        END;
        CREATE TRIGGER IF NOT EXISTS record_dirty_delete AFTER DELETE ON records WHEN substr(OLD.id,1,13)='conversation:' BEGIN
          DELETE FROM record_index WHERE profile=OLD.profile AND module=OLD.module AND id=OLD.id;
          DELETE FROM index_dirty WHERE profile=OLD.profile AND module=OLD.module AND id=OLD.id;
          DELETE FROM records WHERE profile=OLD.profile AND module=OLD.module AND id='metadata:'||OLD.id;
          DELETE FROM records WHERE profile=OLD.profile AND module=OLD.module AND id='council-cache';
          DELETE FROM records WHERE profile=OLD.profile AND module=OLD.module AND id>='council-page:' AND id<'council-page;';
        END;
        CREATE TRIGGER IF NOT EXISTS record_index_insert AFTER INSERT ON record_index BEGIN
          INSERT INTO index_counts(profile,module,total,pending,generation) VALUES(NEW.profile,NEW.module,1,NEW.pending,1)
          ON CONFLICT(profile,module) DO UPDATE SET total=total+1,pending=pending+NEW.pending,generation=generation+1;
        END;
        CREATE TRIGGER IF NOT EXISTS record_index_update AFTER UPDATE ON record_index BEGIN
          UPDATE index_counts SET pending=pending+NEW.pending-OLD.pending,generation=generation+1 WHERE profile=NEW.profile AND module=NEW.module;
        END;
        CREATE TRIGGER IF NOT EXISTS record_index_delete AFTER DELETE ON record_index BEGIN
          UPDATE index_counts SET total=total-1,pending=pending-OLD.pending,generation=generation+1 WHERE profile=OLD.profile AND module=OLD.module;
        END;`);
      const aad = id => Buffer.from(JSON.stringify(["vorton.integration.v1", profile, module, id]));
      const read = row => {
        if (!row) return null;
        this.onRead(row.id);
        const payload = Buffer.from(row.payload);
        check(payload.length >= 29 && payload[0] === 1, "Invalid encrypted integration record", 503);
        const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(1, 13));
        decipher.setAAD(aad(row.id));
        decipher.setAuthTag(payload.subarray(13, 29));
        return JSON.parse(Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString("utf8"));
      };
      const api = {
        get: id => read(db.prepare("SELECT id,payload FROM records WHERE profile=? AND module=? AND id=?").get(profile, module, id)),
        list: (prefix = "") => db.prepare("SELECT id,payload FROM records WHERE profile=? AND module=? AND substr(id,1,?)=? ORDER BY id").all(profile, module, prefix.length, prefix).map(r => ({ id: r.id, value: read(r) })),
        ids: (prefix = "") => db.prepare("SELECT id FROM records WHERE profile=? AND module=? AND substr(id,1,?)=? ORDER BY id").all(profile, module, prefix.length, prefix).map(row => row.id),
        recordBatch: (prefix, after, limit) => db.prepare("SELECT id,payload FROM records WHERE profile=? AND module=? AND id>=? AND id<? AND id>? ORDER BY id LIMIT ?").all(profile, module, prefix, `${prefix}\uffff`, after, limit).map(row => ({ id: row.id, value: read(row) })),
        dayToken: day => createHmac("sha256", key).update(JSON.stringify(["vorton.day.v1", profile, module, day])).digest("hex"),
        indexStats: () => ({ total: 0, pending: 0, generation: 0, ...db.prepare("SELECT total,pending,generation FROM index_counts WHERE profile=? AND module=?").get(profile, module) }),
        indexDirty: () => Boolean(db.prepare("SELECT 1 FROM index_dirty WHERE profile=? AND module=? LIMIT 1").get(profile, module)),
        indexDirtyBatch: limit => db.prepare("SELECT r.id,r.payload FROM index_dirty d JOIN records r USING(profile,module,id) WHERE d.profile=? AND d.module=? ORDER BY d.id LIMIT ?").all(profile, module, limit).map(row => ({ id: row.id, value: read(row) })),
        indexDay: token => db.prepare("SELECT id,position,pending FROM record_index WHERE profile=? AND module=? AND day_token=? ORDER BY position LIMIT 10001").all(profile, module, token),
        indexPending: (after, limit) => db.prepare("SELECT id,position FROM record_index WHERE profile=? AND module=? AND pending=1 AND position>? ORDER BY position LIMIT ?").all(profile, module, after, limit),
        indexHistory: (offset, limit) => db.prepare("SELECT id FROM record_index WHERE profile=? AND module=? ORDER BY position DESC LIMIT ? OFFSET ?").all(profile, module, limit, offset),
        indexPut: (id, metadata, day, pending) => {
          api.put(`metadata:${id}`, metadata);
          db.prepare("INSERT INTO record_index(profile,module,id,day_token,pending) VALUES(?,?,?,?,?) ON CONFLICT(profile,module,id) DO UPDATE SET day_token=excluded.day_token,pending=excluded.pending").run(profile, module, id, api.dayToken(day), Number(pending));
          db.prepare("DELETE FROM index_dirty WHERE profile=? AND module=? AND id=?").run(profile, module, id);
        },
        scan: (prefix, visit) => {
          for (const row of db.prepare("SELECT id,payload FROM records WHERE profile=? AND module=? AND substr(id,1,?)=? ORDER BY id").iterate(profile, module, prefix.length, prefix)) {
            check(!visit({ id: row.id, value: read(row) })?.then, "Integration visitor must be synchronous", 500);
          }
        },
        put: (id, value) => {
          check(typeof id === "string" && /^[a-zA-Z0-9:._-]{1,160}$/.test(id), "Invalid integration record identity");
          const plain = Buffer.from(JSON.stringify(value));
          check(plain.length <= 8 * 1024 * 1024, "Integration record too large", 413);
          const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
          cipher.setAAD(aad(id));
          const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
          plain.fill(0);
          const payload = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
          db.prepare("INSERT INTO records(profile,module,id,payload) VALUES(?,?,?,?) ON CONFLICT(profile,module,id) DO UPDATE SET payload=excluded.payload").run(profile, module, id, payload);
        },
        remove: id => {
          db.prepare("DELETE FROM record_index WHERE profile=? AND module=? AND id=?").run(profile, module, id);
          db.prepare("DELETE FROM records WHERE profile=? AND module=? AND id IN (?,?)").run(profile, module, id, `metadata:${id}`);
        },
        clear: () => {
          db.prepare("DELETE FROM record_index WHERE profile=? AND module=?").run(profile, module);
          db.prepare("DELETE FROM records WHERE profile=? AND module=?").run(profile, module);
        },
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = callback(api);
        check(!result?.then, "Integration transaction must be synchronous", 500);
        db.exec("COMMIT");
        return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    } catch (error) {
      if (error instanceof Fault) throw error;
      // Cryptographic and SQLite errors may carry paths or attacker-controlled values.
      throw new Fault(503, "Integration storage unavailable. Records were not reset.");
    } finally { db?.close(); key?.fill(0); }
  }
}
