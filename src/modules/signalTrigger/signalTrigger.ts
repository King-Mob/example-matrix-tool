import * as sdk from "matrix-js-sdk";
import { sendMessage } from "../../matrixClientRequests";
import * as fs from "fs";
import * as path from "path";

export const signalTrigger = "triggerLink --whatsApp";

export const checkForSignalTrigger = (message: string) => {
  if (message.includes(signalTrigger)) return true;
  return false;
};

export const handleSignalTrigger = async (event: sdk.MatrixEvent) => {
  const roomId = event.getRoomId();
  addSignalRoomId(roomId);
  sendMessage(
    roomId,
    `Trigger request received. Paste the following to connect this Signal group to a WhatsApp group:`
  );
  sendMessage(roomId, `${roomId}`);
};

export const addSignalRoomId = (roomId) => {
  try {
    const filePath = path.join(__dirname.split("dist")[0], "group_ids.json");
    const jsonData = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(jsonData);
    if (!checkIfRoomIdExists(roomId, data)) {
      const newData = JSON.stringify([...data, ["xx", roomId]]);
      fs.writeFileSync(filePath, newData);
    }
  } catch (error) {
    console.error(error);
  }
};
const checkIfRoomIdExists = (roomId: string, data: string[][]) => {
  return Boolean(data.find((roomIds) => roomIds.includes(roomId)));
};
