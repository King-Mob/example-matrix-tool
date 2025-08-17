import { PERSON_NAME } from "./constants";
import { getPseudoState, setPseudoState } from "./pseudoState";

const showAssignedRoles = async (roomId: string) => {
  const messages = [];
  messages.push({ message: "Here are the current people with roles:" });

  const roleState = await getPseudoState(roomId);

  if (!roleState || !roleState.assignedRoles || roleState.assignedRoles.length === 0) {
    messages.push({ message: "There are no roles currently assigned." });
    return messages;
  }

  roleState.assignedRoles.forEach((assignedRole) => {
    messages.push({
      message: `${assignedRole.person.name} has the role ${assignedRole.role.name}. React with 🙏 to remove this role`,
      context: { ...assignedRole }
    }
    );
  });

  return messages;
};

const assignNewRole = async () => {
  return {
    message: "You're assigning a role. Quote-reply to this message with the name of the person receiving the role.",
    context: {
      expecting: PERSON_NAME,
    }
  };
};

const removeRole = async (event) => {
  const roomId = event.room_id;
  const roleToRemove = event.content.context;

  if (!roleToRemove) {
    return;
  }

  const roleState = await getPseudoState(roomId);

  if (!roleState) {
    return;
  }

  const remainingRoles = roleState.assignedRoles.filter(
    (assignedRole) => assignedRole.id !== roleToRemove.id
  );

  setPseudoState(roomId, {
    assignedRoles: remainingRoles,
  });

  return { message: `You have removed the role ${roleToRemove.role.name} from ${roleToRemove.person.name}` };
};

const handleReaction = async (event, botUserId) => {
  const reactionInfo = event.content["m.relates_to"];
  const eventFromReaction = event.prevEvent;

  if (eventFromReaction.sender !== botUserId) return;

  const reactionEmoji = reactionInfo.key.trim();

  //match the reaction to the outcome
  if (reactionEmoji.includes("❤️")) {
    return showAssignedRoles(event.room_id);
  }
  if (reactionEmoji.includes("👍")) {
    return assignNewRole();
  }
  if (reactionEmoji.includes("🙏")) {
    return removeRole(eventFromReaction);
  }

  //reaction not recognised
  return "🤖Example Tool🤖: Sorry, I don't know that reaction."
};

export default handleReaction;
