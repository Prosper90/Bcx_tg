// src/utils/setupWebhook.js
require("dotenv").config();
const axios = require("axios");
const config = require("../config");

async function setupWebhook(ngrokUrl) {
  const token = config.telegramBotToken;
  const webhookUrl = `${ngrokUrl}/telegram-webhook`;

  try {
    // Step 1: Check the current webhook info
    const currentWebhookResponse = await axios.get(
      `https://api.telegram.org/bot${token}/getWebhookInfo`
    );

    const currentWebhook = currentWebhookResponse.data.result.url;

    if (currentWebhook === webhookUrl) {
      console.log("Webhook already set to the correct URL.");
      return {
        status: "unchanged",
        message: "Webhook already set to the correct URL.",
      };
    }

    console.log("Current webhook URL does not match. Setting new webhook...");

    // Step 2: Set the new webhook if it doesn't match
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
    return { status: "updated", data: response.data };
  } catch (error) {
    console.error(
      "Error while checking or setting webhook:",
      error.response?.data || error.message
    );
    throw error;
  }
}

module.exports = { setupWebhook };
