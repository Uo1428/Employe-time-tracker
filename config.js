import dotenv from "dotenv";
dotenv.config();
export default {
  token: process.env.BOT_TOKEN || "PASTE_BOT_TOKEN_HERE_OR_IN_.env_FILE", // discord bot token, take from discord.dev
  mongodb: process.env.MONGODB_URI || "PASTE_TOKEN_HERE_OR_IN_.env_FILE", // mongodb url
};
