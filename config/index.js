// src/config/config.js
require("dotenv").config();

const config = {
  bcxAddress: process.env.BCX_ADDRESS,
  usdtAddress: process.env.USDT_ADDRESS,
  botWallet: process.env.BOT_WALLET_ADDRESS,
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL,
  port: process.env.PORT || 3000,
  discordWebhook: process.env.DISCORD_WEBHOOK_URL,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  ngrok_url: process.env.NGROK_URL,
  mongoUri: process.env.MONGODB_URI,
  implementationContract: process.env.BCX_IMPLEMENTATION,
  fallbackRpcUrl: process.env.RpcUrlTwo,
  buybackConfig: {
    pricePerBcx: 0.5,
    maxSwapSize: 300,
    totalBcxLimit: 100000,
    fee: 0.02, // 2%
  },
};

module.exports = config;
