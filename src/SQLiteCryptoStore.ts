import * as sdk from "matrix-js-sdk";
import Database from "better-sqlite3";
import * as path from "path";
import { CryptoStore, Mode, ISessionInfo, IDeviceData, OutgoingRoomKeyRequest, ISession, IWithheld, ParkedSharedHistory, SecretStorePrivateKeys } from "matrix-js-sdk/lib/crypto/store/base";
import { InboundGroupSessionData } from "matrix-js-sdk/lib/crypto/OlmDevice";
import { IRoomEncryption } from "matrix-js-sdk/lib/crypto/RoomList";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";

/**
 * A crypto storage provider using SQLite for the Matrix JS SDK.
 * Inspired by the RustSdkCryptoStorageProvider from matrix-bot-sdk.
 */
export class SQLiteCryptoStore extends sdk.MemoryCryptoStore {
  private db: Database.Database;
  private deviceId: string | null = null;
  private roomConfigs: Record<string, any> = {};

  constructor(private readonly storagePath: string) {
    super();
    // Ensure the directory exists
    const dbPath = path.join(storagePath, 'crypto.db');
    this.db = new Database(dbPath);
    this.setupDatabase();
    this.loadState();
  }

  private setupDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        config TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS olm_sessions (
        session_id TEXT PRIMARY KEY,
        pickle TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pickle TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cross_signing_keys (
        key_id TEXT PRIMARY KEY,
        key_data TEXT NOT NULL,
        raw_key BLOB
      );

      CREATE TABLE IF NOT EXISTS secret_store (
        key_id TEXT PRIMARY KEY,
        key_data BLOB NOT NULL
      );
    `);
  }

  private loadState() {
    // Load device ID
    const deviceIdRow = this.db.prepare('SELECT value FROM state WHERE key = ?').get('device_id');
    if (deviceIdRow) {
      this.deviceId = deviceIdRow.value;
    }

    // Load rooms
    const roomRows = this.db.prepare('SELECT room_id, config FROM rooms').all();
    for (const row of roomRows) {
      this.roomConfigs[row.room_id] = JSON.parse(row.config);
    }
  }

  private saveState() {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
    if (this.deviceId) {
      stmt.run('device_id', this.deviceId);
    }

    const roomStmt = this.db.prepare('INSERT OR REPLACE INTO rooms (room_id, config) VALUES (?, ?)');
    for (const [roomId, config] of Object.entries(this.roomConfigs)) {
      roomStmt.run(roomId, JSON.stringify(config));
    }
  }

  async doTxn<T>(
    mode: Mode,
    stores: Iterable<string>,
    func: (txn: unknown) => T
  ): Promise<T> {
    if (mode === 'readwrite') {
      this.db.exec('BEGIN TRANSACTION');
    }

    try {
      const result = await func(this.db);
      
      if (mode === 'readwrite') {
        this.saveState();
        this.db.exec('COMMIT');
      }
      
      return result;
    } catch (error) {
      if (mode === 'readwrite') {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }

  // Device ID management
  getDeviceId(txn: Database.Database, func: (deviceId: string | null) => void): void {
    func(this.deviceId);
  }

  storeDeviceId(txn: Database.Database, deviceId: string): void {
    this.deviceId = deviceId;
  }

  // Room management
  getRoom(txn: Database.Database, roomId: string, func: (room: any | null) => void): void {
    func(this.roomConfigs[roomId] || null);
  }

  storeRoom(txn: Database.Database, roomId: string, config: any): void {
    this.roomConfigs[roomId] = config;
  }

  // Olm session management
  storeOlmSession(txn: Database.Database, sessionId: string, pickle: string): void {
    const stmt = txn.prepare('INSERT OR REPLACE INTO olm_sessions (session_id, pickle) VALUES (?, ?)');
    stmt.run(sessionId, pickle);
  }

  getOlmSession(txn: Database.Database, sessionId: string, func: (pickle: string | null) => void): void {
    const stmt = txn.prepare('SELECT pickle FROM olm_sessions WHERE session_id = ?');
    const result = stmt.get(sessionId);
    func(result ? result.pickle : null);
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
    const keys: Record<string, ICrossSigningKey> = {};
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

  // Additional methods for raw key data used by cryptoCallbacks
  getRawCrossSigningKeys(txn: Database.Database, func: (keys: Record<string, Uint8Array> | null) => void): void {
    const stmt = txn.prepare('SELECT key_id, raw_key FROM cross_signing_keys');
    const rows = stmt.all();
    if (rows.length === 0) {
      func(null);
      return;
    }
    const keys: Record<string, Uint8Array> = {};
    for (const row of rows) {
      if (row.raw_key) {
        keys[row.key_id] = row.raw_key;
      }
    }
    func(keys);
  }

  storeRawCrossSigningKeys(txn: Database.Database, keys: Record<string, Uint8Array>): void {
    const stmt = txn.prepare('INSERT OR REPLACE INTO cross_signing_keys (key_id, raw_key) VALUES (?, ?)');
    for (const [keyId, keyData] of Object.entries(keys)) {
      stmt.run(keyId, keyData);
    }
  }

  getSecretStorePrivateKey<K extends keyof SecretStorePrivateKeys>(
    txn: Database.Database,
    func: (key: SecretStorePrivateKeys[K] | null) => void,
    type: K
  ): void {
    const stmt = txn.prepare('SELECT key_data FROM secret_store WHERE key_id = ?');
    const result = stmt.get(type);
    func(result ? result.key_data : null);
  }

  storeSecretStorePrivateKey<K extends keyof SecretStorePrivateKeys>(
    txn: Database.Database,
    type: K,
    key: SecretStorePrivateKeys[K]
  ): void {
    const stmt = txn.prepare('INSERT OR REPLACE INTO secret_store (key_id, key_data) VALUES (?, ?)');
    stmt.run(type, key);
  }

  // Add more method implementations as needed...
} 