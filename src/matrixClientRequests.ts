import { client } from "./client";

export const sendEvent = async (roomId: string, content: any, type: string) => {
  return client.sendEvent(roomId, type, content);
};

export const sendMessage = async (roomId: string, message: string, context = {}) => {
  return client.sendEvent(roomId, "m.room.message", {
    body: message,
    msgtype: "m.text",
    context,
  });
};

export const getEvent = async (roomId: string, eventId: string) => {
  return client.fetchRoomEvent(roomId, eventId);
};

export const getRoomEvents = async (roomId: string) => {
  const room = client.getRoom(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }
  const response = await client.scrollback(room, 10000);
  return {
    json: () => ({
      chunk: response.timeline,
    }),
  };
};

export const redactEvent = async (
  roomId: string,
  eventId: string,
  redactionReason: string
) => {
  return client.redactEvent(roomId, eventId, undefined, { reason: redactionReason });
};
