import { v4 as uuidv4 } from "uuid";
import { sendMessage, getEvent } from "./matrixClientRequests";
import { PERSON_NAME, ROLE_NAME, PSEUDO_STATE_EVENT_TYPE } from "./constants";
import { getPseudoState, setPseudoState } from "./pseudoState";
import { MatrixClient } from "matrix-js-sdk";

const { userId } = process.env;

const hello = async (client: MatrixClient, roomId: string) => {
  sendMessage(
    client,
    roomId,
    `🤖Example Tool🤖: Hello I'm the matrix example tool. 
    I track who has been assigned roles in this group. 
    React to this message with:\n
    ❤️ to see the current assigned roles\n
    👍 to assign a role to someone`
  );
};

const sendPersonRequest = (client: MatrixClient, roomId: string, replyText: string) => {
  sendMessage(
    client,
    roomId,
    `Quote-reply to this message with the name of the role you want to assign to ${replyText}.`,
    {
      person: {
        name: replyText,
      },
      expecting: ROLE_NAME,
    }
  );
};

const assignRole = async (
  client: MatrixClient,
  personName: string,
  roomId: string,
  replyText: string
) => {
  let roleState = await getPseudoState(client, roomId, PSEUDO_STATE_EVENT_TYPE);

  if (!roleState) {
    roleState = {
      content: {
        assignedRoles: [],
      },
    };
  }

  const { assignedRoles } = roleState.content;
  assignedRoles.push({
    id: uuidv4(),
    person: {
      name: personName,
    },
    role: {
      name: replyText,
    },
  });

  await setPseudoState(client, roomId, PSEUDO_STATE_EVENT_TYPE, { assignedRoles });

  sendMessage(client, roomId, `You've assigned ${personName} the role ${replyText}.`);
};

const handleReply = async (client: MatrixClient, event) => {
  const roomId = event.event.room_id;
  const message = event.event.content.body;
  const replyText = message.split("\n\n")[1] || message;
  const prevEventId =
    event.event.content["m.relates_to"]["m.in_reply_to"].event_id;

  const prevEvent = (await getEvent(client, roomId, prevEventId)) as any;

  if (prevEvent.sender !== userId) return;

  const { expecting } = prevEvent.content.context;

  if (expecting === PERSON_NAME) {
    sendPersonRequest(client, roomId, replyText);
  }
  if (expecting === ROLE_NAME) {
    const personName = prevEvent.content.context.person.name;
    assignRole(client, personName, roomId, replyText);
  }
};

const handleMessage = async (client: MatrixClient, event) => {
  console.log(`handling message in room ${event.event.room_id}`, event);
  const message = event.event.content.body.toLowerCase();
  const { room_id } = event.event;

  //if message is a reply, handle reply
  if (event.event.content["m.relates_to"]) {
    handleReply(client, event);
    return;
  }

  //if message has the tool's wake word, say hello
  if (message.includes("example")) {
    hello(client, room_id);
    return;
  }
};

export default handleMessage;
