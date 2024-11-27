// src/server.js
const express = require("express");
const config = require("./config");
const { BuybackBot } = require("./services/BuybackBot");
const { setupWebhook } = require("./utils/setup-webhook");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json());

// MongoDB Connection
const connectToDatabase = async () => {
  try {
    await mongoose.connect(config.mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to the MongoDB database.");
  } catch (error) {
    console.error("Error connecting to the MongoDB database:", error.message);
    process.exit(1);
  }
};

// Mongoose Schema and Model
const transactionSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    bcx_sent: { type: String, required: true },
    usdt_received: { type: String, required: true },
  },
  { timestamps: true } // Automatically add `createdAt` and `updatedAt`
);
const Transaction = mongoose.model("Transaction", transactionSchema);

// Example function to ensure database logic works
const createSampleTransaction = async () => {
  try {
    const sampleTransaction = new Transaction({
      address: "sample_address",
      bcx_sent: "100",
      usdt_received: "50",
    });
    await sampleTransaction.save();
    console.log("Sample transaction saved to MongoDB.");
  } catch (error) {
    console.error("Error creating sample transaction:", error.message);
  }
};

// Basic health check endpoint
app.get("/health", async (req, res) => {
  const token = config.telegramBotToken;
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${token}/getWebhookInfo`
    );

    console.log("Current webhook info:", response.data);
  } catch (error) {
    console.error(
      "Error fetching webhook info:",
      error.response?.data || error.message
    );
  }

  res.json({ status: "healthy", data: response });
});

app.get("/disable_polling", (req, res) => {
  try {
    const bot = new TelegramBot(config.telegramBotToken, { polling: false });
    res.status(200).json({ status: true, data: bot });
  } catch (error) {
    console.log(error);
  }
});

// Start server and optionally setup webhook
const startServer = async () => {
  // const ngrokUrl = config.ngrok_url; // Use .env for the ngrok URL
  // if (!ngrokUrl) {
  //   console.error("NGROK_URL is not set in .env");
  //   process.exit(1);
  // }

  // try {
  //   await setupWebhook(ngrokUrl);
  // } catch (error) {
  //   console.error("Error setting up webhook:", error.message);
  // }

  // Connect to the database
  await connectToDatabase();

  // Create a sample transaction for testing
  // await createSampleTransaction();

  // Initialize BuybackBot with the Mongoose model
  const buybackBot = new BuybackBot(config, Transaction);

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

startServer();
