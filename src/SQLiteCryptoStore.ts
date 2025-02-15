import * as sdk from "matrix-js-sdk";
import Database from "better-sqlite3";
import * as path from "path";
import { CryptoStore, Mode, ISessionInfo, IDeviceData, OutgoingRoomKeyRequest, ISession, IWithheld, ParkedSharedHistory, SecretStorePrivateKeys, IProblem } from "matrix-js-sdk/lib/crypto/store/base";
import { InboundGroupSessionData } from "matrix-js-sdk/lib/crypto/OlmDevice";
import { IRoomEncryption } from "matrix-js-sdk/lib/crypto/RoomList";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";
import { IRoomKeyRequestBody } from "matrix-js-sdk/lib/crypto";
import { IOlmDevice } from "matrix-js-sdk/lib/crypto/algorithms/megolm";

interface StateRow {
  value: string;
}

interface RoomRow {
  room_id: string;
  config: string;
}

interface OlmSessionRow {
  pickle: string;
}

interface AccountRow {
  pickle: string;
}

interface CrossSigningKeyRow {
  key_id: string;
  key_data: string;
  raw_key: Buffer | null;
}

interface InboundGroupSessionRow {
  room_id: string;
  sender_key: string;
  session_id: string;
  session_data: string;
}

interface SessionProblemRow {
  device_key: string;
  type: string;
  fixed: number;
  time: number;
}

interface DeviceDataRow {
  user_id: string;
  device_id: string;
  device_info: string;
}

interface SyncTokenRow {
  token: string | null;
}

interface OutgoingRoomKeyRequestRow {
  request_id: string;
  request_txn_id: string | null;
  cancellation_txn_id: string | null;
  request_body: string;
  state: number;
  recipients: string;
}

interface SessionsNeedingBackupRow {
  room_id: string;
  sender_key: string;
  session_id: string;
  session_data: string;
}

interface RoomKeyRecipient {
  userId: string;
  deviceId: string;
}

interface CrossSigningKeyWithRawRow {
  key_id: string;
  raw_key: Buffer | null;
}

interface SecretStoreRow {
  key_data: Buffer;
}

interface CountRow {
  count: number;
}

interface OlmSessionWithIdRow {
  session_id: string;
  pickle: string;
}

interface UserTrackingRow {
  user_id: string;
  tracking_status: string;
}

interface UserCrossSigningRow {
  user_id: string;
  cross_signing_info: string;
}

interface ParkedSharedHistoryRow {
  sender_id: string;
  sender_key: string;
  session_id: string;
  session_key: string;
  keys_claimed: string;
  forwarding_curve25519_key_chain: string;
}

interface SharedHistoryRow {
  sender_key: string;
  session_id: string;
}

interface GetOrAddOutgoingRoomKeyRequestRow {
  request_id: string;
  request_txn_id: string | null;
  cancellation_txn_id: string | null;
  recipients: string;
  request_body: string;
  state: number;
}

/**
 * A crypto storage provider using SQLite for the Matrix JS SDK.
 * Implements direct database storage without in-memory caching.
 */
export class SQLiteCryptoStore implements CryptoStore {
  private db: Database.Database;

  constructor(private readonly storagePath: string) {
    const dbPath = path.join(storagePath, 'crypto.db');
    this.db = new Database(dbPath);
    this.setupDatabase();
  }

  async startup(): Promise<CryptoStore> {
    // Database is already set up in constructor
    return this;
  }

  async deleteAllData(): Promise<void> {
    // Drop all tables and recreate them
    this.db.exec(`
      DROP TABLE IF EXISTS state;
      DROP TABLE IF EXISTS rooms;
      DROP TABLE IF EXISTS olm_sessions;
      DROP TABLE IF EXISTS account;
      DROP TABLE IF EXISTS cross_signing_keys;
      DROP TABLE IF EXISTS secret_store;
      DROP TABLE IF EXISTS inbound_group_sessions;
      DROP TABLE IF EXISTS outgoing_room_key_requests;
      DROP TABLE IF EXISTS session_problems;
      DROP TABLE IF EXISTS sessions_needing_backup;
      DROP TABLE IF EXISTS shared_history_inbound_sessions;
      DROP TABLE IF EXISTS parked_shared_history;
      DROP TABLE IF EXISTS device_data;
      DROP TABLE IF EXISTS user_tracking_status;
      DROP TABLE IF EXISTS user_cross_signing_info;
      DROP TABLE IF EXISTS sync_token;
    `);

    // Recreate the tables
    this.setupDatabase();
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

      CREATE TABLE IF NOT EXISTS inbound_group_sessions (
        room_id TEXT,
        sender_key TEXT,
        session_id TEXT,
        session_data TEXT NOT NULL,
        PRIMARY KEY (room_id, sender_key, session_id)
      );

      CREATE TABLE IF NOT EXISTS outgoing_room_key_requests (
        request_id TEXT PRIMARY KEY,
        request_txn_id TEXT,
        cancellation_txn_id TEXT,
        recipients TEXT NOT NULL,
        request_body TEXT NOT NULL,
        state INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_problems (
        device_key TEXT,
        type TEXT,
        fixed BOOLEAN,
        time INTEGER NOT NULL,
        PRIMARY KEY (device_key, type, time)
      );

      CREATE TABLE IF NOT EXISTS sessions_needing_backup (
        room_id TEXT,
        sender_key TEXT,
        session_id TEXT,
        needs_backup BOOLEAN NOT NULL DEFAULT true,
        PRIMARY KEY (room_id, sender_key, session_id)
      );

      CREATE TABLE IF NOT EXISTS shared_history_inbound_sessions (
        room_id TEXT,
        sender_key TEXT,
        session_id TEXT,
        PRIMARY KEY (room_id, sender_key, session_id)
      );

      CREATE TABLE IF NOT EXISTS parked_shared_history (
        room_id TEXT,
        sender_id TEXT NOT NULL,
        sender_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        keys_claimed TEXT NOT NULL,
        forwarding_curve25519_key_chain TEXT NOT NULL,
        PRIMARY KEY (room_id, sender_key, session_id)
      );

      CREATE TABLE IF NOT EXISTS device_data (
        user_id TEXT,
        device_id TEXT,
        device_info TEXT NOT NULL,
        PRIMARY KEY (user_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS user_tracking_status (
        user_id TEXT PRIMARY KEY,
        tracking_status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_cross_signing_info (
        user_id TEXT PRIMARY KEY,
        cross_signing_info TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_token (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token TEXT
      );
    `);
  }

  async doTxn<T>(
    mode: Mode,
    stores: Iterable<string>,
    func: (txn: unknown) => T
  ): Promise<T> {
    console.log(`Starting transaction in mode: ${mode}, stores: ${Array.from(stores).join(', ')}`);

    if (mode === 'readwrite') {
      this.db.exec('BEGIN TRANSACTION');
    }

    try {
      const result = await func(this.db);

      if (mode === 'readwrite') {
        this.db.exec('COMMIT');
        console.log('Transaction committed successfully');
      }

      return result;
    } catch (error) {
      console.error('Transaction failed:', error);
      if (mode === 'readwrite') {
        this.db.exec('ROLLBACK');
        console.log('Transaction rolled back');
      }
      throw error;
    }
  }

  // Device ID management
  getDeviceId(_txn: unknown, func: (deviceId: string | null) => void): void {
    console.log('Getting device ID');
    const stmt = this.db.prepare('SELECT value FROM state WHERE key = ?');
    const result = stmt.get('device_id') as StateRow | undefined;
    func(result ? result.value : null);
  }

  storeDeviceId(_txn: unknown, deviceId: string): void {
    console.log('Storing device ID:', deviceId);
    const stmt = this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
    stmt.run('device_id', deviceId);
  }

  // Room management
  getRoom(_txn: unknown, roomId: string, func: (room: IRoomEncryption | null) => void): void {
    const stmt = this.db.prepare('SELECT config FROM rooms WHERE room_id = ?');
    const result = stmt.get(roomId) as RoomRow | undefined;
    func(result ? JSON.parse(result.config) : null);
  }

  storeRoom(_txn: unknown, roomId: string, config: IRoomEncryption): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO rooms (room_id, config) VALUES (?, ?)');
    stmt.run(roomId, JSON.stringify(config));
  }

  // Olm session management
  storeOlmSession(_txn: unknown, sessionId: string, pickle: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO olm_sessions (session_id, pickle) VALUES (?, ?)');
    stmt.run(sessionId, pickle);
  }

  getOlmSession(_txn: unknown, sessionId: string, func: (pickle: string | null) => void): void {
    const stmt = this.db.prepare('SELECT pickle FROM olm_sessions WHERE session_id = ?');
    const result = stmt.get(sessionId) as OlmSessionRow | undefined;
    func(result ? result.pickle : null);
  }

  // Example implementation of a few key methods
  getAccount(_txn: unknown, func: (accountPickle: string | null) => void): void {
    const stmt = this.db.prepare('SELECT pickle FROM account LIMIT 1');
    const result = stmt.get() as AccountRow | undefined;
    func(result ? result.pickle : null);
  }

  storeAccount(_txn: unknown, accountPickle: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO account (id, pickle) VALUES (1, ?)');
    stmt.run(accountPickle);
  }

  getCrossSigningKeys(_txn: unknown, func: (keys: Record<string, ICrossSigningKey> | null) => void): void {
    const stmt = this.db.prepare('SELECT key_id, key_data FROM cross_signing_keys');
    const rows = stmt.all() as CrossSigningKeyRow[];
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

  storeCrossSigningKeys(_txn: unknown, keys: Record<string, ICrossSigningKey>): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO cross_signing_keys (key_id, key_data) VALUES (?, ?)');
    for (const [keyId, keyData] of Object.entries(keys)) {
      stmt.run(keyId, JSON.stringify(keyData));
    }
  }

  // Additional methods for raw key data used by cryptoCallbacks
  getRawCrossSigningKeys(_txn: unknown, func: (keys: Record<string, Uint8Array> | null) => void): void {
    const stmt = this.db.prepare('SELECT key_id, raw_key FROM cross_signing_keys');
    const rows = stmt.all() as CrossSigningKeyWithRawRow[];
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

  storeRawCrossSigningKeys(_txn: unknown, keys: Record<string, Uint8Array>): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO cross_signing_keys (key_id, raw_key) VALUES (?, ?)');
    for (const [keyId, keyData] of Object.entries(keys)) {
      stmt.run(keyId, keyData);
    }
  }

  getSecretStorePrivateKey<K extends keyof SecretStorePrivateKeys>(
    _txn: unknown,
    func: (key: SecretStorePrivateKeys[K] | null) => void,
    type: K
  ): void {
    console.log('Getting secret store private key:', type);
    const stmt = this.db.prepare('SELECT key_data FROM secret_store WHERE key_id = ?');
    const result = stmt.get(type) as SecretStoreRow | undefined;
    // First convert to unknown, then to the expected type to avoid direct Buffer conversion
    func(result ? (JSON.parse(result.key_data.toString()) as SecretStorePrivateKeys[K]) : null);
  }

  storeSecretStorePrivateKey<K extends keyof SecretStorePrivateKeys>(
    _txn: unknown,
    type: K,
    key: SecretStorePrivateKeys[K]
  ): void {
    console.log('Storing secret store private key:', type);
    const stmt = this.db.prepare('INSERT OR REPLACE INTO secret_store (key_id, key_data) VALUES (?, ?)');
    stmt.run(type, key);
  }

  // Add these new methods for inbound group sessions
  storeEndToEndInboundGroupSession(
    senderCurve25519Key: string,
    sessionId: string,
    sessionData: InboundGroupSessionData,
    _txn: unknown
  ): void {
    console.log(`Storing inbound group session - Sender: ${senderCurve25519Key}, Session: ${sessionId}`);
    const stmt = this.db.prepare('INSERT OR REPLACE INTO inbound_group_sessions (room_id, sender_key, session_id, session_data) VALUES (?, ?, ?, ?)');
    const sessionJson = JSON.stringify(sessionData);
    console.log('Session data size:', sessionJson.length);
    stmt.run(sessionData.room_id, senderCurve25519Key, sessionId, sessionJson);
  }

  getEndToEndInboundGroupSession(
    senderCurve25519Key: string,
    sessionId: string,
    _txn: unknown,
    func: (session: InboundGroupSessionData | null, groupSessionWithheld: IWithheld | null) => void
  ): void {
    console.log(`Getting inbound group session - Sender: ${senderCurve25519Key}, Session: ${sessionId}`);
    const stmt = this.db.prepare('SELECT session_data FROM inbound_group_sessions WHERE sender_key = ? AND session_id = ?');
    const result = stmt.get(senderCurve25519Key, sessionId) as InboundGroupSessionRow | undefined;
    if (result) {
      console.log('Found session in database');
    } else {
      console.log('Session not found in database');
    }
    func(result ? JSON.parse(result.session_data) : null, null);
  }

  getAllEndToEndInboundGroupSessions(
    _txn: unknown,
    func: (session: ISession) => void
  ): void {
    console.log('Getting all inbound group sessions');
    const stmt = this.db.prepare('SELECT room_id, sender_key, session_id, session_data FROM inbound_group_sessions');
    const rows = stmt.all() as InboundGroupSessionRow[];
    console.log(`Found ${rows.length} sessions in database`);

    // Call the callback for each session individually
    for (const row of rows) {
      const sessionData = JSON.parse(row.session_data);
      func({
        senderKey: row.sender_key,
        sessionId: row.session_id,
        sessionData: sessionData
      });
    }
  }

  // Outgoing room key request management
  async getOrAddOutgoingRoomKeyRequest(request: OutgoingRoomKeyRequest): Promise<OutgoingRoomKeyRequest> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE request_id = ?'
    );
    const result = stmt.get(request.requestId) as GetOrAddOutgoingRoomKeyRequestRow | undefined;

    if (result) {
      return {
        requestId: result.request_id,
        requestTxnId: result.request_txn_id,
        cancellationTxnId: result.cancellation_txn_id,
        recipients: JSON.parse(result.recipients),
        requestBody: JSON.parse(result.request_body),
        state: result.state,
      };
    }

    // Not found, add it
    const insertStmt = this.db.prepare(
      'INSERT INTO outgoing_room_key_requests (request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertStmt.run(
      request.requestId,
      request.requestTxnId,
      request.cancellationTxnId,
      JSON.stringify(request.recipients),
      JSON.stringify(request.requestBody),
      request.state
    );

    return request;
  }

  async getOutgoingRoomKeyRequest(requestBody: IRoomKeyRequestBody): Promise<OutgoingRoomKeyRequest | null> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE request_body = ?'
    );
    const result = stmt.get(JSON.stringify(requestBody)) as OutgoingRoomKeyRequestRow | undefined;
    if (!result) return null;

    return {
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      requestBody: JSON.parse(result.request_body),
      state: result.state,
      recipients: JSON.parse(result.recipients)
    };
  }

  async getOutgoingRoomKeyRequestByState(wantedStates: number[]): Promise<OutgoingRoomKeyRequest | null> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE state IN (' +
      wantedStates.map(() => '?').join(',') +
      ') LIMIT 1'
    );
    const result = stmt.get(...wantedStates) as OutgoingRoomKeyRequestRow | undefined;
    if (!result) return null;

    return {
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      requestBody: JSON.parse(result.request_body),
      state: result.state,
      recipients: JSON.parse(result.recipients)
    };
  }

  async getAllOutgoingRoomKeyRequestsByState(wantedState: number): Promise<OutgoingRoomKeyRequest[]> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE state = ?'
    );
    const results = stmt.all(wantedState) as OutgoingRoomKeyRequestRow[];

    return results.map(row => ({
      requestId: row.request_id,
      requestTxnId: row.request_txn_id,
      cancellationTxnId: row.cancellation_txn_id,
      requestBody: JSON.parse(row.request_body),
      state: row.state,
      recipients: JSON.parse(row.recipients) as RoomKeyRecipient[]
    }));
  }

  async updateOutgoingRoomKeyRequest(
    requestId: string,
    expectedState: number,
    updates: Partial<OutgoingRoomKeyRequest>
  ): Promise<OutgoingRoomKeyRequest | null> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE request_id = ? AND state = ?'
    );
    const result = stmt.get(requestId, expectedState) as OutgoingRoomKeyRequestRow | undefined;
    if (!result) return null;

    const updateData: Partial<OutgoingRoomKeyRequestRow> = {};
    if (updates.requestTxnId !== undefined) updateData.request_txn_id = updates.requestTxnId;
    if (updates.cancellationTxnId !== undefined) updateData.cancellation_txn_id = updates.cancellationTxnId;
    if (updates.state !== undefined) updateData.state = updates.state;

    if (Object.keys(updateData).length > 0) {
      const updateStmt = this.db.prepare(
        'UPDATE outgoing_room_key_requests SET ' +
        Object.keys(updateData)
          .map(key => `${key} = ?`)
          .join(', ') +
        ' WHERE request_id = ?'
      );

      updateStmt.run(...Object.values(updateData), requestId);
    }

    return {
      requestId: result.request_id,
      requestTxnId: updates.requestTxnId ?? result.request_txn_id,
      cancellationTxnId: updates.cancellationTxnId ?? result.cancellation_txn_id,
      requestBody: JSON.parse(result.request_body),
      state: updates.state ?? result.state,
      recipients: JSON.parse(result.recipients) as RoomKeyRecipient[]
    };
  }

  async deleteOutgoingRoomKeyRequest(
    requestId: string,
    expectedState: number
  ): Promise<OutgoingRoomKeyRequest | null> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE request_id = ? AND state = ?'
    );
    const result = stmt.get(requestId, expectedState) as OutgoingRoomKeyRequestRow | undefined;
    if (!result) return null;

    const deleteStmt = this.db.prepare('DELETE FROM outgoing_room_key_requests WHERE request_id = ?');
    deleteStmt.run(requestId);

    return {
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      requestBody: JSON.parse(result.request_body),
      state: result.state,
      recipients: JSON.parse(result.recipients) as RoomKeyRecipient[]
    };
  }

  // Session problem tracking
  async storeEndToEndSessionProblem(deviceKey: string, type: string, fixed: boolean): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO session_problems (device_key, type, fixed, time) VALUES (?, ?, ?, ?)'
    );
    stmt.run(deviceKey, type, fixed, Date.now());
  }

  async getEndToEndSessionProblem(deviceKey: string, timestamp: number): Promise<IProblem | null> {
    const stmt = this.db.prepare(
      `SELECT type, fixed, time
       FROM session_problems
       WHERE device_key = ? AND time <= ?
       ORDER BY time DESC
       LIMIT 1`
    );
    const result = stmt.get(deviceKey, timestamp) as SessionProblemRow | undefined;

    if (!result) return null;

    return {
      type: result.type,
      fixed: Boolean(result.fixed),
      time: result.time,
    };
  }

  async filterOutNotifiedErrorDevices(devices: IOlmDevice[]): Promise<IOlmDevice[]> {
    const stmt = this.db.prepare(
      `SELECT DISTINCT device_key
       FROM session_problems
       WHERE fixed = true`
    );
    const fixedDevices = new Set(stmt.all().map((row: { device_key: string }) => row.device_key));

    return devices.filter(device => !fixedDevices.has(device.userId + ":" + device.deviceInfo.deviceId));
  }

  // Session backup tracking
  async getSessionsNeedingBackup(limit: number): Promise<ISession[]> {
    const stmt = this.db.prepare(
      `SELECT s.room_id, s.sender_key, s.session_id, i.session_data
       FROM sessions_needing_backup s
       INNER JOIN inbound_group_sessions i
         ON s.room_id = i.room_id
         AND s.sender_key = i.sender_key
         AND s.session_id = i.session_id
       WHERE s.needs_backup = true
       LIMIT ?`
    );
    const results = stmt.all(limit) as SessionsNeedingBackupRow[];

    return results.map(row => ({
      senderKey: row.sender_key,
      sessionId: row.session_id,
      sessionData: JSON.parse(row.session_data)
    }));
  }

  async countSessionsNeedingBackup(_txn?: unknown): Promise<number> {
    const stmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM sessions_needing_backup WHERE needs_backup = true'
    );
    const result = stmt.get() as CountRow;
    return result.count;
  }

  async unmarkSessionsNeedingBackup(sessions: ISession[], _txn?: unknown): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE sessions_needing_backup
       SET needs_backup = false
       WHERE room_id = ? AND sender_key = ? AND session_id = ?`
    );

    // Get the room_id from the session data
    for (const session of sessions) {
      const roomId = session.sessionData?.room_id;
      if (!roomId) {
        console.warn('Session missing room_id in sessionData:', session);
        continue;
      }
      stmt.run(roomId, session.senderKey, session.sessionId);
    }
  }

  async markSessionsNeedingBackup(sessions: ISession[], _txn?: unknown): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO sessions_needing_backup (room_id, sender_key, session_id, needs_backup)
       VALUES (?, ?, ?, true)`
    );

    // Get the room_id from the session data
    for (const session of sessions) {
      const roomId = session.sessionData?.room_id;
      if (!roomId) {
        console.warn('Session missing room_id in sessionData:', session);
        continue;
      }
      stmt.run(roomId, session.senderKey, session.sessionId);
    }
  }

  // Shared history management
  async addSharedHistoryInboundGroupSession(
    roomId: string,
    senderKey: string,
    sessionId: string,
    _txn?: unknown
  ): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO shared_history_inbound_sessions (room_id, sender_key, session_id) VALUES (?, ?, ?)'
    );
    stmt.run(roomId, senderKey, sessionId);
  }

  async getSharedHistoryInboundGroupSessions(
    roomId: string,
    _txn?: unknown
  ): Promise<[senderKey: string, sessionId: string][]> {
    const stmt = this.db.prepare(
      'SELECT sender_key, session_id FROM shared_history_inbound_sessions WHERE room_id = ?'
    );
    const results = stmt.all(roomId) as SharedHistoryRow[];

    return results.map(row => [row.sender_key, row.session_id]);
  }

  async addParkedSharedHistory(
    roomId: string,
    data: ParkedSharedHistory,
    _txn?: unknown
  ): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO parked_shared_history
       (room_id, sender_id, sender_key, session_id, session_key, keys_claimed, forwarding_curve25519_key_chain)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      roomId,
      data.senderId,
      data.senderKey,
      data.sessionId,
      data.sessionKey,
      JSON.stringify(data.keysClaimed),
      JSON.stringify(data.forwardingCurve25519KeyChain)
    );
  }

  async takeParkedSharedHistory(
    roomId: string,
    _txn?: unknown
  ): Promise<ParkedSharedHistory[]> {
    const selectStmt = this.db.prepare(
      `SELECT sender_id, sender_key, session_id, session_key, keys_claimed, forwarding_curve25519_key_chain
       FROM parked_shared_history
       WHERE room_id = ?`
    );
    const results = selectStmt.all(roomId) as ParkedSharedHistoryRow[];

    if (results.length === 0) {
      return [];
    }

    const deleteStmt = this.db.prepare('DELETE FROM parked_shared_history WHERE room_id = ?');
    deleteStmt.run(roomId);

    return results.map(row => ({
      senderId: row.sender_id,
      senderKey: row.sender_key,
      sessionId: row.session_id,
      sessionKey: row.session_key,
      keysClaimed: JSON.parse(row.keys_claimed),
      forwardingCurve25519KeyChain: JSON.parse(row.forwarding_curve25519_key_chain)
    }));
  }

  // Device data management
  getEndToEndDeviceData(_txn: unknown, func: (deviceData: IDeviceData | null) => void): void {
    const deviceStmt = this.db.prepare('SELECT user_id, device_id, device_info FROM device_data');
    const trackingStmt = this.db.prepare('SELECT user_id, tracking_status FROM user_tracking_status');
    const crossSigningStmt = this.db.prepare('SELECT user_id, cross_signing_info FROM user_cross_signing_info');
    const syncTokenStmt = this.db.prepare('SELECT token FROM sync_token WHERE id = 1');

    const devices: { [userId: string]: { [deviceId: string]: any } } = {};
    const trackingStatus: { [userId: string]: any } = {};
    let crossSigningInfo: Record<string, any> = {};

    for (const row of deviceStmt.all() as DeviceDataRow[]) {
      if (!devices[row.user_id]) {
        devices[row.user_id] = {};
      }
      devices[row.user_id][row.device_id] = JSON.parse(row.device_info);
    }

    for (const row of trackingStmt.all() as UserTrackingRow[]) {
      trackingStatus[row.user_id] = row.tracking_status;
    }

    for (const row of crossSigningStmt.all() as UserCrossSigningRow[]) {
      crossSigningInfo[row.user_id] = JSON.parse(row.cross_signing_info);
    }

    const syncTokenRow = syncTokenStmt.get() as SyncTokenRow | undefined;
    const syncToken = syncTokenRow ? syncTokenRow.token : null;

    func({
      devices,
      trackingStatus,
      crossSigningInfo,
      syncToken
    });
  }

  storeEndToEndDeviceData(deviceData: IDeviceData, _txn: unknown): void {
    // Start by clearing existing data since we're replacing everything
    this.db.exec(`
      DELETE FROM device_data;
      DELETE FROM user_tracking_status;
      DELETE FROM user_cross_signing_info;
      DELETE FROM sync_token;
    `);

    // Prepare statements for bulk inserts
    const deviceStmt = this.db.prepare(
      'INSERT INTO device_data (user_id, device_id, device_info) VALUES (?, ?, ?)'
    );
    const trackingStmt = this.db.prepare(
      'INSERT INTO user_tracking_status (user_id, tracking_status) VALUES (?, ?)'
    );
    const crossSigningStmt = this.db.prepare(
      'INSERT INTO user_cross_signing_info (user_id, cross_signing_info) VALUES (?, ?)'
    );
    const syncTokenStmt = this.db.prepare(
      'INSERT INTO sync_token (id, token) VALUES (1, ?)'
    );

    // Store devices
    for (const [userId, devices] of Object.entries(deviceData.devices)) {
      for (const [deviceId, deviceInfo] of Object.entries(devices)) {
        deviceStmt.run(userId, deviceId, JSON.stringify(deviceInfo));
      }
    }

    // Store tracking status
    for (const [userId, status] of Object.entries(deviceData.trackingStatus)) {
      trackingStmt.run(userId, status);
    }

    // Store cross signing info if present
    if (deviceData.crossSigningInfo) {
      for (const [userId, info] of Object.entries(deviceData.crossSigningInfo)) {
        crossSigningStmt.run(userId, JSON.stringify(info));
      }
    }

    // Store sync token if present
    if (deviceData.syncToken) {
      syncTokenStmt.run(deviceData.syncToken);
    }
  }

  // Session counting and management
  countEndToEndSessions(_txn: unknown, func: (count: number) => void): void {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM olm_sessions');
    const result = stmt.get() as CountRow;
    func(result.count);
  }

  getEndToEndSession(
    deviceKey: string,
    sessionId: string,
    _txn: unknown,
    func: (session: ISessionInfo | null) => void
  ): void {
    const stmt = this.db.prepare('SELECT pickle FROM olm_sessions WHERE session_id = ?');
    const result = stmt.get(sessionId) as OlmSessionRow | undefined;

    if (!result) {
      func(null);
      return;
    }

    func({
      deviceKey,
      sessionId,
      session: result.pickle,
    });
  }

  getEndToEndSessions(
    deviceKey: string,
    _txn: unknown,
    func: (sessions: { [sessionId: string]: ISessionInfo }) => void
  ): void {
    const stmt = this.db.prepare('SELECT session_id, pickle FROM olm_sessions');
    const results = stmt.all() as OlmSessionWithIdRow[];

    const sessions: { [sessionId: string]: ISessionInfo } = {};
    for (const row of results) {
      sessions[row.session_id] = {
        deviceKey,
        sessionId: row.session_id,
        session: row.pickle,
      };
    }

    func(sessions);
  }

  getAllEndToEndSessions(
    _txn: unknown,
    func: (session: ISessionInfo) => void
  ): void {
    const stmt = this.db.prepare('SELECT session_id, pickle FROM olm_sessions');
    const results = stmt.all() as OlmSessionWithIdRow[];

    for (const row of results) {
      func({
        sessionId: row.session_id,
        session: row.pickle,
      });
    }
  }

  storeEndToEndSession(
    deviceKey: string,
    sessionId: string,
    sessionInfo: ISessionInfo,
    _txn: unknown
  ): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO olm_sessions (session_id, pickle) VALUES (?, ?)'
    );
    stmt.run(sessionId, sessionInfo.session);
  }

  // Inbound group session management
  addEndToEndInboundGroupSession(
    senderCurve25519Key: string,
    sessionId: string,
    sessionData: InboundGroupSessionData,
    _txn: unknown
  ): void {
    // This is an alias for storeEndToEndInboundGroupSession
    this.storeEndToEndInboundGroupSession(senderCurve25519Key, sessionId, sessionData, _txn);
  }

  storeEndToEndInboundGroupSessionWithheld(
    senderCurve25519Key: string,
    sessionId: string,
    sessionData: IWithheld,
    _txn: unknown
  ): void {
    // Store withheld session data in the same table with a special flag or prefix
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO inbound_group_sessions
       (room_id, sender_key, session_id, session_data)
       VALUES (?, ?, ?, ?)`
    );
    stmt.run(
      sessionData.room_id,
      senderCurve25519Key,
      sessionId,
      JSON.stringify({ ...sessionData, __withheld: true })
    );
  }

  // End-to-end room management
  storeEndToEndRoom(roomId: string, roomInfo: IRoomEncryption, _txn: unknown): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO rooms (room_id, config) VALUES (?, ?)');
    stmt.run(roomId, JSON.stringify(roomInfo));
  }

  getEndToEndRooms(_txn: unknown, func: (rooms: Record<string, IRoomEncryption>) => void): void {
    const stmt = this.db.prepare('SELECT room_id, config FROM rooms');
    const results = stmt.all() as RoomRow[];

    const rooms: Record<string, IRoomEncryption> = {};
    for (const row of results) {
      rooms[row.room_id] = JSON.parse(row.config);
    }

    func(rooms);
  }

  async getOutgoingRoomKeyRequestsByTarget(
    userId: string,
    deviceId: string,
    wantedStates: number[]
  ): Promise<OutgoingRoomKeyRequest[]> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, request_body, state, recipients FROM outgoing_room_key_requests WHERE state IN (' +
      wantedStates.map(() => '?').join(',') +
      ')'
    );
    const results = stmt.all(...wantedStates) as OutgoingRoomKeyRequestRow[];

    return results
      .filter(row => {
        const recipients = JSON.parse(row.recipients) as RoomKeyRecipient[];
        return recipients.some(r => r.userId === userId && r.deviceId === deviceId);
      })
      .map(row => ({
        requestId: row.request_id,
        requestTxnId: row.request_txn_id,
        cancellationTxnId: row.cancellation_txn_id,
        requestBody: JSON.parse(row.request_body),
        state: row.state,
        recipients: JSON.parse(row.recipients) as RoomKeyRecipient[]
      }));
  }
}
