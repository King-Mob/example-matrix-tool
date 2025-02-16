import { PERSON_NAME, PSEUDO_STATE_EVENT_TYPE } from "./constants";
import { sendMessage, getEvent } from "./matrixClientRequests";
import { getPseudoState, setPseudoState } from "./pseudoState";
import { MatrixClient } from "matrix-js-sdk";

const { userId } = process.env;

const showAssignedRoles = async (client: MatrixClient, roomId: string) => {
  sendMessage(client, roomId, "Here are the current people with roles:");

  const roleState = await getPseudoState(client, roomId, PSEUDO_STATE_EVENT_TYPE);

  if (!roleState) {
    sendMessage(client, roomId, "There are no roles currently assigned.");
    return;
  }

  roleState.content.assignedRoles.forEach((assignedRole) => {
    sendMessage(
      client,
      roomId,
      `${assignedRole.person.name} has the role ${assignedRole.role.name}. React with 🙏 to remove this role`,
      {
        ...assignedRole,
      }
    );
  });
};

const assignNewRole = async (client: MatrixClient, roomId: string) => {
  sendMessage(
    client,
    roomId,
    "You're assigning a role. Quote-reply to this message with the name of the person receiving the role.",
    {
      expecting: PERSON_NAME,
    }
  );
};

const removeRole = async (client: MatrixClient, event) => {
  const roomId = event.room_id;
  const roleToRemove = event.content.context;

  if (!roleToRemove) {
    return;
  }

  const roleState = await getPseudoState(client, roomId, PSEUDO_STATE_EVENT_TYPE);

  if (!roleState) {
    return;
  }

  const remainingRoles = roleState.content.assignedRoles.filter(
    (assignedRole) => assignedRole.id !== roleToRemove.id
  );

  sendMessage(
    client,
    roomId,
    `You have removed the role ${roleToRemove.role.name} from ${roleToRemove.person.name}`
  );

  setPseudoState(client, roomId, PSEUDO_STATE_EVENT_TYPE, {
    assignedRoles: remainingRoles,
  });
};

const handleReaction = async (client: MatrixClient, event) => {
  const reactionInfo = event.event.content["m.relates_to"];
  const eventFromReaction = (await getEvent(
    client,
    event.event.room_id,
    reactionInfo.event_id
  )) as any;

  if (eventFromReaction.sender !== userId) return;

  const reactionEmoji = reactionInfo.key.trim();

  //match the reaction to the outcome
  if (reactionEmoji.includes("❤️")) {
    showAssignedRoles(client, event.event.room_id);
    return;
  }
  if (reactionEmoji.includes("👍")) {
    assignNewRole(client, event.event.room_id);
    return;
  }
  if (reactionEmoji.includes("🙏")) {
    removeRole(client, eventFromReaction);
    return;
  }

  //reaction not recognised
  sendMessage(
    client,
    event.room_id,
    "🤖Example Tool🤖: Sorry, I don't know that reaction."
  );
  return;
};

export default handleReaction;
