import express from "express";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import handleMessage from "./messages";
import handleReaction from "./reactions";

const port = 5049;

const moduleRegistration = {
  id: "example",
  uuid: uuidv4(),
  url: `http://localhost:${port}`,
  emoji: "👍",
  wake_word: "example",
  title: "Example App",
  description: "This module manages a list of roles",
  event_types: [
    "m.room.message",
    "m.reaction"
  ]
}

function generateRegistrationFile() {
  fs.writeFileSync(`./${moduleRegistration.id}.json`, JSON.stringify(moduleRegistration));
}

async function start() {

  const app = express();
  app.use(express.json());

  app.post("/", async (req, res) => {
    const { event, botUserId } = req.body;

    console.log(event)
    let response = {};

    if (event.type === "m.room.message")
      response = await handleMessage(event, botUserId);

    if (event.type === "m.reaction")
      response = await handleReaction(event, botUserId);

    console.log(response)

    res.send({ success: true, response });
  });


  app.listen(port);
};

generateRegistrationFile();
start();
