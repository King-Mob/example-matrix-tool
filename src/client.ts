import * as sdk from "matrix-js-sdk";
import * as path from "path";
import { SQLiteCryptoStore } from "./SQLiteCryptoStore";

const { access_token, homeserver, userId } = process.env;

if (!homeserver || !access_token || !userId) {
  throw new Error("Missing required environment variables");
}

// Create a SQLite crypto store in the project directory
const dbPath = path.join(process.cwd(), 'crypto.db');
const cryptoStore = new SQLiteCryptoStore(dbPath);

export const client = sdk.createClient({
  baseUrl: homeserver,
  accessToken: access_token,
  userId,
  cryptoStore,
  deviceId: `EXAMPLE_TOOL_${Math.floor(Math.random() * 10000)}`,
  useAuthorizationHeader: true,
  verificationMethods: [],
  cryptoCallbacks: {
    getCrossSigningKey: async () => null,
    saveCrossSigningKeys: async () => {},
    getSecretStorageKey: async () => null,
    cacheSecretStorageKey: async () => {},
  },
});
