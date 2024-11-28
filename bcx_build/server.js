// src/server.js
const express = require("express");
const config = require("./config");
const { BuybackBot } = require("./services/BuybackBot");
const { setupWebhook } = require("./utils/setup-webhook");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const BcxABI = require("./utils/BcxABI.json");
const {
  ethers,
  formatEther,
  parseEther,
  WebSocketProvider,
  isAddress,
  id,
} = require("ethers");

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

app.get("/initiate_webhook_bot", async (req, res) => {
  try {
    const ngrokUrl = config.ngrok_url; // Use .env for the ngrok URL
    if (!ngrokUrl) {
      console.error("NGROK_URL is not set in .env");
      return;
    }
    const dataDone = await setupWebhook(ngrokUrl);
    console.log("done");
    res
      .status(200)
      .json({ status: true, message: "connected", data: dataDone });
  } catch (error) {
    console.log(error);
  }
});

// Start server and optionally setup webhook
const startServer = async () => {
  // Connect to the database
  await connectToDatabase();

  // Create a sample transaction for testing
  // await createSampleTransaction();

  // Initialize BuybackBot with the Mongoose model
  const buybackBot = new BuybackBot(config, Transaction);

  // const provider = new WebSocketProvider(config.rpcUrl);
  // const contractAddress = config.bcxAddress; // Proxy contract address

  // // Add reconnection logic for WebSocket errors
  // provider.on("error", (error) => {
  //   console.error("WebSocket error:", error);
  //   provider._websocket?.terminate(); // Close the current WebSocket connection
  //   provider.connect(); // Reconnect

  //   // Remove existing listeners to avoid duplicates
  //   provider.removeAllListeners(filter);

  //   // Re-add the filter listener
  //   provider.on(filter, handleTransferEvent);
  // });

  // const filter = {
  //     address: contractAddress, // Or the implementation contract address if known
  //     topics: [id("Transfer(address,address,uint256)")],
  // };

  // console.log(provider, "checking the provider object")

  // const handleTransferEvent = async (log) => {
  //   try {
  //     console.log("Transfer detected:");
  //     // Process the log as before
  //     const iface = new ethers.Interface(BcxABI);
  //       const decodedEvent = iface.parseLog(log);

  //       // Decode the event log using the implementation ABI
  //       if (decodedEvent.args.to.toLowerCase() !== config.botWallet.toLowerCase()) {
  //         return;
  //       }

  //      const chatId = await buybackBot.findChatIdByTransaction(decodedEvent.args.from);
  //      if (!chatId) return;

  //      await buybackBot.notifyUp(chatId);

  //       await buybackBot.processBuyback(
  //         decodedEvent.args.from,
  //         decodedEvent.args.value,
  //         await buybackBot.findChatIdByTransaction(decodedEvent.args.from)
  //       );

  //   } catch (error) {
  //     console.error("Error processing transfer event:", error);
  //   }
  // };

  // provider.on(filter, handleTransferEvent);

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

startServer();
