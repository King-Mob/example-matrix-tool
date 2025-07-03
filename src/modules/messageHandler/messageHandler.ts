import * as fs from "fs";
import "dotenv/config";

export const readDataFromJson = () => {
  try {
    const json = fs.readFileSync("./group_ids.json", "utf8");
    const result: Array<string[]> = JSON.parse(json);
    return result;
  } catch (err) {
    console.error(err);
  }
};

/**
 * Compare the roomId with the linkedRoom ids stored in JSON
 * @param roomId roomId the event comes from
 * @returns true if the roomId already exists in the JSON
 */

export const compareLinkedRoomIds = (roomId: string) => {
  const data = readDataFromJson();
  return Boolean(data.find((roomIds: string[]) => roomIds.includes(roomId)));
};

/**
 * This retrieves the linked roomid pairs: [whatsApp roomid, Signal roomid]
 * It will return the linked roomId, so it it receives the whatsApp roomid
 * It will return the Signal roomid, and vice versa
 * @param roomId the roomid where the event was sent from
 * @returns
 */
export const retrieveLinkedRoomId = (roomId: string) => {
  const roomIds = readDataFromJson();

  const linkedIdPairs: string[] = roomIds.find((roomIdPairs: string[]) =>
    roomIdPairs.includes(roomId)
  );

  const linkedId = linkedIdPairs.filter((id) => id !== roomId);
  return linkedId;
};
