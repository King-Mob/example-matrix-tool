import * as sdk from "matrix-js-sdk";

const { access_token, homeserver, userId } = process.env;

if (!homeserver || !access_token || !userId) {
  throw new Error("Missing required environment variables");
}

export const client = sdk.createClient({
  baseUrl: homeserver,
  accessToken: access_token,
  userId,
  cryptoStore: new sdk.MemoryCryptoStore(),
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
