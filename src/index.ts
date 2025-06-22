import "dotenv/config";
import * as sdk from "matrix-js-sdk";
import { RoomEvent, ClientEvent } from "matrix-js-sdk";
import handleMessage from "./messages";
import handleReaction from "./reactions";
import {
  checkForSignalTrigger,
  handleSignalTrigger,
} from "./modules/signalTrigger/signalTrigger";
import {
  checkForWhatsAppTrigger,
  handleWhatsAppTrigger,
} from "./modules/whatsAppTrigger/whatsAppTrigger";
import {
  compareLinkedRoomIds,
  retrieveLinkedRoomId,
} from "./modules/messageHandler/messageHandler";

const { homeserver, access_token, userId, whatsAppRoomId, signalRoomId } =
  process.env;

const client = sdk.createClient({
  baseUrl: homeserver,
  accessToken: access_token,
  userId,
});

const start = async () => {
  await client.startClient();

  client.once(ClientEvent.Sync, async (state, prevState, res) => {
    // state will be 'PREPARED' when the client is ready to use
    console.log(state);
  });

  const scriptStart = Date.now();

  client.on(
    RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      const eventTime = event.event.origin_server_ts;

      if (scriptStart > eventTime) {
        return; //don't run commands for old messages
      }

      if (event.event.sender === userId) {
        //return; // don't reply to messages sent by the tool
        console.log(`SELF MESSAGE`);
      }

      console.log(`CHECKING FOR TRIGGERS`);
      checkforTriggers(event);

      if (!compareLinkedRoomIds(event.getRoomId())) {
        return; // don't activate unless in the active room
      }

      //console.log(`EVENT ${event.getRoomId()}`);
      console.log(`EVENT`);
      const linkedId = retrieveLinkedRoomId(event.getRoomId());

      if (
        event.getType() !== "m.room.message" &&
        event.getType() !== "m.reaction"
      ) {
        console.log("skipping event:", event);
        return; // only use messages or reactions
      }

      console.log(`IS MESSAGE`);
      if (event.getType() === "m.room.message") handleMessage(event, linkedId);

      if (event.getType() === "m.reaction") handleReaction(event);
    }
  );
};

const checkforTriggers = (event: sdk.MatrixEvent) => {
  if (
    event.getType() === "m.room.message" &&
    checkForSignalTrigger(event.event.content.body)
  ) {
        console.log(`HANDLE SIGNAL TRIGGER`);
        handleSignalTrigger(event);
        
    }

  if (
    event.getType() === "m.room.message" &&
    checkForWhatsAppTrigger(event.event.content.body)
  ) {
        console.log(`HANDLE WHATSAPP TRIGGER`);
        handleWhatsAppTrigger(event);
    }
};

start();
