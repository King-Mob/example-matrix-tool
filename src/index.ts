import "dotenv/config";
import * as sdk from "matrix-js-sdk";
import Olm from "@matrix-org/olm";
import handleMessage from "./messages";
import handleReaction from "./reactions";
import { sendMessage } from "./matrixClientRequests";
import { client } from "./client";

const { whatsAppRoomId, userId } = process.env;

if (!whatsAppRoomId) {
  throw new Error("Missing whatsAppRoomId environment variable");
}

const start = async () => {
  // Initialize Olm
  await Olm.init();
  global.Olm = Olm;

  await client.initCrypto();
  await client.startClient({initialSyncLimit: 0, includeArchivedRooms: false});

  client.once(sdk.ClientEvent.Sync, async (state, prevState, res) => {
    // state will be 'PREPARED' when the client is ready to use
    console.log('--------------------------------');
    console.log("Sync state:", state);
  });

  const scriptStart = Date.now();

  client.on(
    sdk.RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      console.log('--------------------------------');
      console.log(`Timeline event ${event.getType()} from ${event.sender} in room ${room.roomId}`);
      console.log(`toStartOfTimeline: ${toStartOfTimeline}`);
      const eventTime = event.event.origin_server_ts;

      if (!eventTime || scriptStart > eventTime * 1000) {
        return; //don't run commands for old messages
      }

      console.log(`Event time: ${new Date(eventTime).toLocaleString()} after script start: ${new Date(scriptStart).toLocaleString()}`);

      if (event.event.sender === userId) {
        console.log("skipping event from self");
        return; // don't reply to messages sent by the tool
      }

      if (event.event.room_id !== whatsAppRoomId) {
        console.log(`skipping event in ${event.event.room_id} not active room ${whatsAppRoomId}`);
        return; // don't activate unless in the active room
      }

      if (event.isEncrypted()) {
        console.log(`decrypting event ${event.getType()} in room ${event.event.room_id}`);
        try {
          const crypto = client.crypto;
          if (!crypto) {
            console.error("Crypto not initialized");
            return;
          }
          await event.attemptDecryption(crypto);
          console.log(`maybe decrypted event ${event.getType()} in room ${event.event.room_id}`, event);
          if (event.isDecryptionFailure) {
            console.log(
              `Failed to decrypt event ${event.getType()} in room ${event.event.room_id}`
              );
            return;
          }
        } catch (err) {
          console.error("Failed to decrypt event:", err);
          return;
        }
      } else {
        console.log(`cleartext event ${event.getType()} in room ${event.event.room_id}`);
      }

      if (
        event.getType() !== "m.room.message" &&
        event.getType() !== "m.reaction"
      ) {
        console.log("skipping event:", event);
        return; // only use messages or reactions
      }

      if (event.getType() === "m.room.message") {
        handleMessage(event);
      }

      if (event.getType() === "m.reaction") handleReaction(event);
    }
  );

  client.on(sdk.CryptoEvent.RoomKeyRequest, (event) => {
    console.log('--------------------------------');
    console.log("Room key request received");
  });
};

start().catch((err) => {
  console.error("Error starting client:", err);
  process.exit(1);
});
