import * as sdk from "matrix-js-sdk";
import Database from "better-sqlite3";
import * as path from "path";
import { CryptoStore, Mode, ISessionInfo, IDeviceData, OutgoingRoomKeyRequest, ISession, IWithheld, ParkedSharedHistory, SecretStorePrivateKeys, IProblem } from "matrix-js-sdk/lib/crypto/store/base";
import { InboundGroupSessionData } from "matrix-js-sdk/lib/crypto/OlmDevice";
import { IRoomEncryption } from "matrix-js-sdk/lib/crypto/RoomList";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";
import { IRoomKeyRequestBody } from "matrix-js-sdk/lib/crypto";
import { IOlmDevice } from "matrix-js-sdk/lib/crypto/algorithms/megolm";

/**
 * A crypto storage provider using SQLite for the Matrix JS SDK.
 * Inspired by the RustSdkCryptoStorageProvider from matrix-bot-sdk.
 */
export class SQLiteCryptoStore extends sdk.MemoryCryptoStore {
  private db: Database.Database;

  constructor(private readonly storagePath: string) {
    super();
    // Ensure the directory exists
    const dbPath = path.join(storagePath, 'crypto.db');
    this.db = new Database(dbPath);
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
    const result = stmt.get('device_id');
    func(result ? result.value : null);
  }

  storeDeviceId(_txn: unknown, deviceId: string): void {
    console.log('Storing device ID:', deviceId);
    const stmt = this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)');
    stmt.run('device_id', deviceId);
  }

  // Room management
  getRoom(_txn: unknown, roomId: string, func: (room: any | null) => void): void {
    const stmt = this.db.prepare('SELECT config FROM rooms WHERE room_id = ?');
    const result = stmt.get(roomId);
    func(result ? JSON.parse(result.config) : null);
  }

  storeRoom(_txn: unknown, roomId: string, config: any): void {
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
    const result = stmt.get(sessionId);
    func(result ? result.pickle : null);
  }

  // Example implementation of a few key methods
  getAccount(_txn: unknown, func: (accountPickle: string | null) => void): void {
    const stmt = this.db.prepare('SELECT pickle FROM account LIMIT 1');
    const result = stmt.get();
    func(result ? result.pickle : null);
  }

  storeAccount(_txn: unknown, accountPickle: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO account (id, pickle) VALUES (1, ?)');
    stmt.run(accountPickle);
  }

  getCrossSigningKeys(_txn: unknown, func: (keys: Record<string, ICrossSigningKey> | null) => void): void {
    const stmt = this.db.prepare('SELECT key_id, key_data FROM cross_signing_keys');
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

  storeCrossSigningKeys(_txn: unknown, keys: Record<string, ICrossSigningKey>): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO cross_signing_keys (key_id, key_data) VALUES (?, ?)');
    for (const [keyId, keyData] of Object.entries(keys)) {
      stmt.run(keyId, JSON.stringify(keyData));
    }
  }

  // Additional methods for raw key data used by cryptoCallbacks
  getRawCrossSigningKeys(_txn: unknown, func: (keys: Record<string, Uint8Array> | null) => void): void {
    const stmt = this.db.prepare('SELECT key_id, raw_key FROM cross_signing_keys');
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
    const result = stmt.get(type);
    func(result ? result.key_data : null);
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
    const result = stmt.get(senderCurve25519Key, sessionId);
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
    const rows = stmt.all();
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
    // First check if we already have this request
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE request_id = ?'
    );
    const result = stmt.get(request.requestId);
    
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
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE request_body = ?'
    );
    const result = stmt.get(JSON.stringify(requestBody));
    
    if (!result) return null;

    return {
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      recipients: JSON.parse(result.recipients),
      requestBody: JSON.parse(result.request_body),
      state: result.state,
    };
  }

  async getOutgoingRoomKeyRequestByState(wantedStates: number[]): Promise<OutgoingRoomKeyRequest | null> {
    const placeholders = wantedStates.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state 
       FROM outgoing_room_key_requests 
       WHERE state IN (${placeholders})
       LIMIT 1`
    );
    const result = stmt.get(...wantedStates);
    
    if (!result) return null;

    return {
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      recipients: JSON.parse(result.recipients),
      requestBody: JSON.parse(result.request_body),
      state: result.state,
    };
  }

  async getAllOutgoingRoomKeyRequestsByState(wantedState: number): Promise<OutgoingRoomKeyRequest[]> {
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE state = ?'
    );
    const results = stmt.all(wantedState);
    
    return results.map(result => ({
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      recipients: JSON.parse(result.recipients),
      requestBody: JSON.parse(result.request_body),
      state: result.state,
    }));
  }

  async getOutgoingRoomKeyRequestsByTarget(
    userId: string,
    deviceId: string,
    wantedStates: number[]
  ): Promise<OutgoingRoomKeyRequest[]> {
    const placeholders = wantedStates.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state 
       FROM outgoing_room_key_requests 
       WHERE state IN (${placeholders})
       AND recipients LIKE ?`
    );
    
    // Search for recipients that include this user/device combination
    // Note: This is a bit of a hack since we're searching JSON as text
    const targetPattern = `%"userId":"${userId}"%"deviceId":"${deviceId}"%`;
    const results = stmt.all(...wantedStates, targetPattern);
    
    return results.map(result => ({
      requestId: result.request_id,
      requestTxnId: result.request_txn_id,
      cancellationTxnId: result.cancellation_txn_id,
      recipients: JSON.parse(result.recipients),
      requestBody: JSON.parse(result.request_body),
      state: result.state,
    }));
  }

  async updateOutgoingRoomKeyRequest(
    requestId: string,
    expectedState: number,
    updates: Partial<OutgoingRoomKeyRequest>
  ): Promise<OutgoingRoomKeyRequest | null> {
    // First get the current state
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE request_id = ? AND state = ?'
    );
    const current = stmt.get(requestId, expectedState);
    
    if (!current) return null;

    // Merge current with updates
    const updated = {
      requestId: current.request_id,
      requestTxnId: updates.requestTxnId ?? current.request_txn_id,
      cancellationTxnId: updates.cancellationTxnId ?? current.cancellation_txn_id,
      recipients: updates.recipients ?? JSON.parse(current.recipients),
      requestBody: updates.requestBody ?? JSON.parse(current.request_body),
      state: updates.state ?? current.state,
    };

    // Update the record
    const updateStmt = this.db.prepare(
      'UPDATE outgoing_room_key_requests SET request_txn_id = ?, cancellation_txn_id = ?, recipients = ?, request_body = ?, state = ? WHERE request_id = ?'
    );
    updateStmt.run(
      updated.requestTxnId,
      updated.cancellationTxnId,
      JSON.stringify(updated.recipients),
      JSON.stringify(updated.requestBody),
      updated.state,
      requestId
    );

    return updated;
  }

  async deleteOutgoingRoomKeyRequest(
    requestId: string,
    expectedState: number
  ): Promise<OutgoingRoomKeyRequest | null> {
    // First get the current state
    const stmt = this.db.prepare(
      'SELECT request_id, request_txn_id, cancellation_txn_id, recipients, request_body, state FROM outgoing_room_key_requests WHERE request_id = ? AND state = ?'
    );
    const current = stmt.get(requestId, expectedState);
    
    if (!current) return null;

    // Delete the record
    const deleteStmt = this.db.prepare('DELETE FROM outgoing_room_key_requests WHERE request_id = ?');
    deleteStmt.run(requestId);

    // Return the deleted record
    return {
      requestId: current.request_id,
      requestTxnId: current.request_txn_id,
      cancellationTxnId: current.cancellation_txn_id,
      recipients: JSON.parse(current.recipients),
      requestBody: JSON.parse(current.request_body),
      state: current.state,
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
    // Get the most recent problem for this device that occurred before the given timestamp
    const stmt = this.db.prepare(
      `SELECT type, fixed, time 
       FROM session_problems 
       WHERE device_key = ? AND time <= ? 
       ORDER BY time DESC 
       LIMIT 1`
    );
    const result = stmt.get(deviceKey, timestamp);
    
    if (!result) return null;

    return {
      type: result.type,
      fixed: Boolean(result.fixed), // Convert from SQLite INTEGER to boolean
      time: result.time,
    };
  }

  async filterOutNotifiedErrorDevices(devices: IOlmDevice[]): Promise<IOlmDevice[]> {
    // Get all devices that have had problems marked as fixed
    const stmt = this.db.prepare(
      `SELECT DISTINCT device_key 
       FROM session_problems 
       WHERE fixed = true`
    );
    const fixedDevices = new Set(stmt.all().map(row => row.device_key));
    
    // Filter out devices that have had their problems marked as fixed
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
    const results = stmt.all(limit);
    
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
    const result = stmt.get();
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
    const results = stmt.all(roomId);
    
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
    // First get all parked history for this room
    const selectStmt = this.db.prepare(
      `SELECT sender_id, sender_key, session_id, session_key, keys_claimed, forwarding_curve25519_key_chain 
       FROM parked_shared_history 
       WHERE room_id = ?`
    );
    const results = selectStmt.all(roomId);
    
    if (results.length === 0) {
      return [];
    }

    // Delete the records we're about to return
    const deleteStmt = this.db.prepare('DELETE FROM parked_shared_history WHERE room_id = ?');
    deleteStmt.run(roomId);
    
    // Return the found records
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
    // Get all device data in one go
    const deviceStmt = this.db.prepare('SELECT user_id, device_id, device_info FROM device_data');
    const trackingStmt = this.db.prepare('SELECT user_id, tracking_status FROM user_tracking_status');
    const crossSigningStmt = this.db.prepare('SELECT user_id, cross_signing_info FROM user_cross_signing_info');
    const syncTokenStmt = this.db.prepare('SELECT token FROM sync_token WHERE id = 1');

    const devices: { [userId: string]: { [deviceId: string]: any } } = {};
    const trackingStatus: { [userId: string]: any } = {};
    let crossSigningInfo: Record<string, any> = {};
    
    // Build devices map
    for (const row of deviceStmt.all()) {
      if (!devices[row.user_id]) {
        devices[row.user_id] = {};
      }
      devices[row.user_id][row.device_id] = JSON.parse(row.device_info);
    }

    // Build tracking status map
    for (const row of trackingStmt.all()) {
      trackingStatus[row.user_id] = row.tracking_status;
    }

    // Get cross signing info
    for (const row of crossSigningStmt.all()) {
      crossSigningInfo[row.user_id] = JSON.parse(row.cross_signing_info);
    }

    // Get sync token
    const syncTokenRow = syncTokenStmt.get();
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

  // End-to-end room management
  storeEndToEndRoom(roomId: string, roomInfo: IRoomEncryption, _txn: unknown): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO rooms (room_id, config) VALUES (?, ?)');
    stmt.run(roomId, JSON.stringify(roomInfo));
  }

  getEndToEndRooms(_txn: unknown, func: (rooms: Record<string, IRoomEncryption>) => void): void {
    const stmt = this.db.prepare('SELECT room_id, config FROM rooms');
    const results = stmt.all();
    
    const rooms: Record<string, IRoomEncryption> = {};
    for (const row of results) {
      rooms[row.room_id] = JSON.parse(row.config);
    }
    
    func(rooms);
  }

  // Add more method implementations as needed...
} 