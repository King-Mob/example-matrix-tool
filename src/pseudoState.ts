import { getRoomEvents, sendEvent } from "./matrixClientRequests";
import { MatrixClient } from "matrix-js-sdk";

export const getPseudoState = async (client: MatrixClient, roomId: string, stateType: string) => {
  const eventsResponse = await getRoomEvents(client, roomId);
  const events = (await eventsResponse.json()) as any;

  const pseudoState = events.chunk.find((event) => event.type === stateType);
  return pseudoState;
};

export const setPseudoState = async (
  client: MatrixClient,
  roomId: string,
  stateType: string,
  content: any
) => {
  return sendEvent(client, roomId, stateType, content);
};
