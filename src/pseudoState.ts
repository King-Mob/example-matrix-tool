const pseudoState = {};

export const getPseudoState = async (roomId: string) => {
  return pseudoState[roomId];
};

export const setPseudoState = async (
  roomId: string,
  content: any
) => {
  pseudoState[roomId] = content;
};
