// src/utils/setupWebhook.js
require("dotenv").config();
const axios = require("axios");
const config = require("../config");

async function setupWebhook(ngrokUrl) {
  const token = config.telegramBotToken;
  const webhookUrl = `${ngrokUrl}/telegram-webhook`;

  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        params: {
          url: webhookUrl,
          drop_pending_updates: true,
        },
      }
    );

    console.log("Webhook setup response:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "Webhook setup failed:",
      error.response?.data || error.message
    );
    throw error;
  }
}

module.exports = { setupWebhook };
