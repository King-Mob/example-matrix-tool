import * as sdk from "matrix-js-sdk";
import * as path from "path";
import * as fs from "fs";
import { ICrossSigningKey } from "matrix-js-sdk/lib/client";
import { SecretStorePrivateKeys } from "matrix-js-sdk/lib/crypto/store/base";
import { initAsync, Tracing, LoggerLevel, OlmMachine, UserId, DeviceId } from "@matrix-org/matrix-sdk-crypto-wasm";
import { ICryptoCallbacks } from "matrix-js-sdk/lib/crypto";

const { access_token, homeserver, userId } = process.env;

if (!homeserver || !access_token || !userId) {
  throw new Error("Missing required environment variables");
}

export const loadCrypto = async (userId: string, deviceId: string) => {
    // Do this before any other calls to the library
    await initAsync();

    // Optional: enable tracing in the rust-sdk
    new Tracing(LoggerLevel.Trace).turnOn();

    // Create a new OlmMachine
    //
    // The following will use an in-memory store. It is recommended to use
    // indexedDB where that is available.
    // See https://matrix-org.github.io/matrix-rust-sdk-crypto-wasm/classes/OlmMachine.html#initialize
    // const olmmachine = await olmmachine.initialize(
    //   new userid(userid),
    //   new deviceid(deviceid),
    //   null,
    //   null
    //   // process.cwd() + "/crypto-store",
    //   // "foobar"
    // );
    // console.log("olmmachine", olmmachine);
    // return olmmachine;
};

export const getClient = async (userId: string, deviceId: string) => {
  // const olmMachine = await loadCrypto(userId, deviceId);
  const cryptoStore = new sdk.MemoryCryptoStore();

  const global_key = {
    keyId: "m.secret_storage.key.default_key",
    key: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  };

  const client = sdk.createClient({
    baseUrl: homeserver,
    accessToken: access_token,
    userId,
    // cryptoStore,
    // pickleKey: olmMachine.pickleKey,
    deviceId: `EXAMPLE_TOOL_${Math.floor(Math.random() * 10000)}`,
    useAuthorizationHeader: true,
    verificationMethods: [],
    cryptoCallbacks: {
      getCrossSigningKey: async () => {
        let result = null;
        await cryptoStore.doTxn('readonly', ['crossSigning'], (txn) => {
          (cryptoStore as any).getRawCrossSigningKeys(txn, (keys) => {
            result = keys;
          });
        });
        return result;
      },
      saveCrossSigningKeys: (keys) => {
        return cryptoStore.doTxn('readwrite', ['crossSigning'], (txn) => {
          (cryptoStore as any).storeRawCrossSigningKeys(txn, keys);
        });
      },
      // getSecretStorageKey: async (keys, keyId: string) => {
      //   console.log('getSecretStorageKey', keys, keyId);
      //   // This function should prompt the user to enter their secret storage key.
      //   // For testing purposes, using a hardcoded key - in production this should be properly secured
      //   return [keyId, global_key.key];
      // },
      getSecretStorageKey: async (keys, name) => {
        console.log('getSecretStorageKey', keys, name);
        let result = null;
        await cryptoStore.doTxn('readonly', ['secretStore'], (txn) => {
          cryptoStore.getSecretStorePrivateKey(txn, (key) => {
            result = key;
          }, name as any);
        });
        return result ? [name, result] : null;
      },
      cacheSecretStorageKey: async (name, keyInfo, key) => {
        console.log('cacheSecretStorageKey', name, keyInfo, key);
        global_key.keyId = name;
        global_key.key = key;
        // await cryptoStore.doTxn('readwrite', ['secretStore'], (txn) => {
        //   cryptoStore.storeSecretStorePrivateKey(txn, name, key);
        // });
      },
    },
  });

  // Initialize to enable end-to-end encryption support.
  await client.initRustCrypto({
    useIndexedDB: false,
    userId: new UserId(userId),
    deviceId: new DeviceId(deviceId),
  });
  console.log('********');

  await client.getCrypto().bootstrapSecretStorage({
    createSecretStorageKey: async () => {
      return {
        keyInfo: {
          name: "m.secret_storage.key.default_key",
          algorithm: "m.secret_storage.v1.aes-hmac-sha2",
          passphrase: {
            algorithm: "m.pbkdf2",
            iterations: 500000,
            salt: "somesalt"
          }
        },
        // This should be a proper key in production
        privateKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
      };
    },
  });

  client.getCrypto().bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
      await makeRequest({});
    },
  });

  // Check if we have a key backup.
  // If checkKeyBackupAndEnable returns null, there is no key backup.
  const hasKeyBackup = (await client.getCrypto().checkKeyBackupAndEnable()) !== null;

  // Create the key backup
  await client.getCrypto().resetKeyBackup();

  return client;
};
