import { v4 as uuidv4 } from "uuid";
import { PERSON_NAME, ROLE_NAME } from "./constants";
import { getPseudoState, setPseudoState } from "./pseudoState";

const hello = async () => {
  return {
    message: `🤖Example Tool🤖: Hello I'm the matrix example tool. 
    I track who has been assigned roles in this group. 
    React to this message with:\n
    ❤️ to see the current assigned roles\n
    👍 to assign a role to someone`};
};

const sendPersonRequest = (replyText: string) => {
  return {
    message: `Quote-reply to this message with the name of the role you want to assign to ${replyText}.`,
    context: {
      person: {
        name: replyText,
      },
      expecting: ROLE_NAME,
    }
  }
};

const assignRole = async (
  personName: string,
  roomId: string,
  replyText: string
) => {
  let roleState = await getPseudoState(roomId);

  if (!roleState) {
    roleState = {
      assignedRoles: [],
    };
  }

  const { assignedRoles } = roleState;
  assignedRoles.push({
    id: uuidv4(),
    person: {
      name: personName,
    },
    role: {
      name: replyText,
    },
  });

  setPseudoState(roomId, { assignedRoles });

  return { message: `You've assigned ${personName} the role ${replyText}.` };
};

const handleReply = async (event, botUserId) => {
  const roomId = event.room_id;
  const message = event.content.body;
  const replyText = message.split("\n\n")[1] || message;
  const prevEvent = event.prevEvent;

  if (prevEvent.sender !== botUserId) return;

  const { expecting } = prevEvent.content.context;

  if (expecting === PERSON_NAME) {
    return sendPersonRequest(replyText);
  }
  if (expecting === ROLE_NAME) {
    const personName = prevEvent.content.context.person.name;
    return assignRole(personName, roomId, replyText);
  }
};

const handleMessage = async (event, botUserId) => {
  const message = event.content.body.toLowerCase();

  //if message is a reply, handle reply
  if (event.content["m.relates_to"]) {
    return handleReply(event, botUserId);;
  }

  //if message has the tool's wake word, say hello
  if (message.includes("example")) {
    return hello();
  }
};

export default handleMessage;
