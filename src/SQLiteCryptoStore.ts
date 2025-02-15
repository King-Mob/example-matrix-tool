import * as sdk from "matrix-js-sdk";
import Database from "better-sqlite3";
import { CryptoStore, Mode, ISessionInfo, IDeviceData, OutgoingRoomKeyRequest, ISession, IWithheld, ParkedSharedHistory } from "matrix-js-sdk/lib/crypto/store/base";
import { InboundGroupSessionData } from "matrix-js-sdk/lib/crypto/OlmDevice";
import { IRoomEncryption } from "matrix-js-sdk/lib/crypto/RoomList";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";
import { SecretStorePrivateKeys } from "matrix-js-sdk/lib/crypto/store/base";

// SQLite-based crypto store implementation
export class SQLiteCryptoStore extends sdk.MemoryCryptoStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    super();
    this.db = new Database(dbPath);
    this.setupDatabase();
  }

  private setupDatabase() {
    // Create tables if they don't exist
    this.db.exec(`
      -- Account data
      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY,
        pickle TEXT NOT NULL
      );

      -- Cross signing keys
      CREATE TABLE IF NOT EXISTS cross_signing_keys (
        key_id TEXT PRIMARY KEY,
        key_data TEXT NOT NULL
      );

      -- Secret store private keys
      CREATE TABLE IF NOT EXISTS secret_store_private_keys (
        key_type TEXT PRIMARY KEY,
        key_data TEXT NOT NULL
      );

      -- End-to-end sessions
      CREATE TABLE IF NOT EXISTS e2e_sessions (
        device_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_data TEXT NOT NULL,
        PRIMARY KEY (device_key, session_id)
      );

      -- Session problems
      CREATE TABLE IF NOT EXISTS session_problems (
        device_key TEXT NOT NULL,
        problem_type TEXT NOT NULL,
        fixed BOOLEAN NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (device_key, timestamp)
      );

      -- Inbound group sessions
      CREATE TABLE IF NOT EXISTS inbound_group_sessions (
        sender_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_data TEXT NOT NULL,
        withheld_data TEXT,
        PRIMARY KEY (sender_key, session_id)
      );

      -- Device data
      CREATE TABLE IF NOT EXISTS device_data (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL
      );

      -- Encrypted rooms
      CREATE TABLE IF NOT EXISTS encrypted_rooms (
        room_id TEXT PRIMARY KEY,
        room_info TEXT NOT NULL
      );

      -- Outgoing key requests
      CREATE TABLE IF NOT EXISTS outgoing_key_requests (
        request_id TEXT PRIMARY KEY,
        request_data TEXT NOT NULL
      );

      -- Shared history sessions
      CREATE TABLE IF NOT EXISTS shared_history_sessions (
        room_id TEXT NOT NULL,
        sender_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (room_id, sender_key, session_id)
      );

      -- Parked shared history
      CREATE TABLE IF NOT EXISTS parked_shared_history (
        room_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (room_id)
      );

      -- Sessions needing backup
      CREATE TABLE IF NOT EXISTS sessions_needing_backup (
        sender_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (sender_key, session_id)
      );
    `);
  }

  // Override necessary methods from MemoryCryptoStore
  async doTxn<T>(
    mode: Mode,
    stores: Iterable<string>,
    func: (txn: unknown) => T
  ): Promise<T> {
    // Start a transaction if in write mode
    if (mode === 'readwrite') {
      this.db.exec('BEGIN TRANSACTION');
    }

    try {
      const result = await func(this.db);
      
      // Commit the transaction if in write mode
      if (mode === 'readwrite') {
        this.db.exec('COMMIT');
      }
      
      return result;
    } catch (error) {
      // Rollback the transaction if in write mode
      if (mode === 'readwrite') {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }

  // Example implementation of a few key methods
  getAccount(txn: Database.Database, func: (accountPickle: string | null) => void): void {
    const stmt = txn.prepare('SELECT pickle FROM account LIMIT 1');
    const result = stmt.get();
    func(result ? result.pickle : null);
  }

  storeAccount(txn: Database.Database, accountPickle: string): void {
    const stmt = txn.prepare('INSERT OR REPLACE INTO account (id, pickle) VALUES (1, ?)');
    stmt.run(accountPickle);
  }

  getCrossSigningKeys(txn: Database.Database, func: (keys: Record<string, ICrossSigningKey> | null) => void): void {
    const stmt = txn.prepare('SELECT key_id, key_data FROM cross_signing_keys');
    const rows = stmt.all();
    if (rows.length === 0) {
      func(null);
      return;
    }
    const keys = {};
    for (const row of rows) {
      keys[row.key_id] = JSON.parse(row.key_data);
    }
    func(keys);
  }

  storeCrossSigningKeys(txn: Database.Database, keys: Record<string, ICrossSigningKey>): void {
    const stmt = txn.prepare('INSERT OR REPLACE INTO cross_signing_keys (key_id, key_data) VALUES (?, ?)');
    for (const [keyId, keyData] of Object.entries(keys)) {
      stmt.run(keyId, JSON.stringify(keyData));
    }
  }

  // Add more method implementations as needed...
} 