import * as sdk from "matrix-js-sdk";
import * as path from "path";
import * as fs from "fs";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";
import { SecretStorePrivateKeys } from "matrix-js-sdk/lib/crypto/store/base";
import { ICryptoCallbacks } from "matrix-js-sdk/lib/crypto";

const { access_token, homeserver, userId } = process.env;

if (!homeserver || !access_token || !userId) {
  throw new Error("Missing required environment variables");
}

const cryptoStore = new sdk.MemoryCryptoStore();

export const client = sdk.createClient({
  baseUrl: homeserver,
  accessToken: access_token,
  userId,
  cryptoStore,
  deviceId: `EXAMPLE_TOOL_${Math.floor(Math.random() * 10000)}`,
  useAuthorizationHeader: true,
  verificationMethods: [],
  cryptoCallbacks: {
    getCrossSigningKey: async () => {
      let result = null;
      await cryptoStore.doTxn('readonly', ['crossSigningKeys'], (txn) => {
        (cryptoStore as any).getRawCrossSigningKeys(txn, (keys) => {
          result = keys;
        });
      });
      return result;
    },
    saveCrossSigningKeys: (keys) => {
      return cryptoStore.doTxn('readwrite', ['crossSigningKeys'], (txn) => {
        (cryptoStore as any).storeRawCrossSigningKeys(txn, keys);
      });
    },
    getSecretStorageKey: async (keys, name) => {
      let result = null;
      await cryptoStore.doTxn('readonly', ['secretStore'], (txn) => {
        cryptoStore.getSecretStorePrivateKey(txn, (key) => {
          result = key;
        }, name as any);
      });
      return result ? [name, result] : null;
    },
    cacheSecretStorageKey: async (name, key) => {
      await cryptoStore.doTxn('readwrite', ['secretStore'], (txn) => {
        cryptoStore.storeSecretStorePrivateKey(txn, name as any, key);
      });
    },
  },
});
