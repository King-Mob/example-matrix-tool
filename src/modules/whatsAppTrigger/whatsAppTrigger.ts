import * as sdk from "matrix-js-sdk";
import { sendMessage } from "../../matrixClientRequests";
import * as fs from "fs";
import * as path from "path";

export const whatsAppTrigger = "triggerLink --signal";

export const checkForWhatsAppTrigger = (message: string) => {
  console.log(`CHECKING FOR WHATSAPP TRIGGER!!!`)
  if (message.includes(whatsAppTrigger)) return true;
  return false;
};

export const handleWhatsAppTrigger = async (event: sdk.MatrixEvent) => {
  const roomId = event.getRoomId();
  const message = event.getContent().body;
  const signalRoomId = message.split("##")[1] || 'the given user';
  console.log("SIGNALROOMID" + signalRoomId);
  matchGroupId(roomId, signalRoomId);
  sendMessage(
    roomId,
    `We are not '${signalRoomId}'. I will store and use this to connect the chat`
    //`We are not this user. I will store and use this to connect the chat`
  );
};

export const matchGroupId = (whatsAppRoomId, signalRoomId) => {
  try {
    const filePath = path.join(__dirname.split("dist")[0], "group_ids.json");
    const jsonData = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(jsonData);
    console.log(`DATA: ${data} TYPE: ${typeof(data)} LENGTH: ${data.length}`);
    const newData = data.map((groupIds) => {
    //console.log(`IF CONDITION IS ${groupIds.length >= 2 && groupIds[1] == signalRoomId && groupIds[0] == "xx"}`);
    console.log(`GROUPIDS: ${groupIds}`);
    console.log(`IF CONDITION IS ${groupIds.length >= 1 && groupIds[1] == signalRoomId && groupIds[0] == "xx"}`);
    console.log(`SECOND THING: ${groupIds[1]}`);
    console.log(`SIGNALROOMID: ${signalRoomId}`);
    console.log(groupIds[1] == signalRoomId);
    console.log(groupIds[0] == "xx");
      if ( groupIds.length >= 1 && groupIds[1] == signalRoomId.trim() && groupIds[0] == "xx") {
        console.log(`GOT ${signalRoomId}`);
        return [whatsAppRoomId, signalRoomId];
      } else {
        console.log(`IF BRANCH FAILED. SignalRoomId: ${signalRoomId} groupId: ${groupIds[0]}`);
      }
      return groupIds;
    });
    fs.writeFileSync(filePath, JSON.stringify(newData));
  } catch (error) {
    console.error(error);
  }
};
