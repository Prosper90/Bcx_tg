// src/services/BuybackBot.js
const {
  ethers,
  formatEther,
  parseEther,
  WebSocketProvider,
} = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
// const { formatEther, parseEther } = ethers.utils;
const TokenABI = require("../utils/TokenABI.json");
const BcxABI = require("../utils/BcxABI.json");

// src/services/BuybackBot.js

class BuybackBot {
  constructor(config, connection) {
    this.config = config;
    this.connection = connection;
    this.activeUsers = new Map(); // Store user session data
    this.totalBcxBought = 0;
    this.isActive = false;
    this.pendingTransactions = new Map(); // Track pending transactions

    // Initialize blockchain connection
    this.provider = new WebSocketProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Initialize contracts
    this.bcxContract = new ethers.Contract(
      config.bcxAddress,
      BcxABI,
      this.wallet
    );

    this.usdtContract = new ethers.Contract(
      config.usdtAddress,
      TokenABI,
      this.wallet
    );

    // Initialize Telegram bot
    this.telegramBot = new TelegramBot(config.telegramBotToken, {
      polling: true,
    });
    this.setupBotCommands();
  }

  setupBotCommands() {
    this.telegramBot.setMyCommands([
      {
        command: "/start",
        description: "Start interacting with the buyback bot",
      },
      { command: "/info", description: "Get current buyback information" },
    ]);

    this.telegramBot.on("message", (msg) => this.handleMessage(msg));
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    switch (text) {
      case "/start":
        await this.handleStartCommand(chatId);
        break;
      case "/info":
        await this.handleInfoCommand(chatId);
        break;
      default:
        // Handle potential wallet addresses
        if (ethers.isAddress(text)) {
          await this.handleAddressSubmission(chatId, text);
        }
    }
  }

  async handleStartCommand(chatId) {
    const message = `
🤖 Welcome to the BCX Buyback Bot!

    Current Conditions:
    • Price: $${this.config.buybackConfig.pricePerBcx} per BCX
    • Maximum swap: ${this.config.buybackConfig.maxSwapSize} BCX
    • Fee: ${this.config.buybackConfig.fee * 100}%

    To sell your BCX:
    1. Send your BCX to: ${this.config.botWallet}
    2. Share your USDT wallet address with me here

    Your transaction will be processed automatically and you'll receive notifications about the status.

    Use /info to see bcx buyback info.
`;
    await this.telegramBot.sendMessage(chatId, message);
  }

  async handleInfoCommand(chatId) {
    try {
      // Query the database to calculate the total BCX bought (sum of bcx_sent)
      const totalResult = await this.connection.aggregate([
        {
          $group: {
            _id: null,
            totalBcxBought: { $sum: { $toDouble: "$bcx_sent" } },
          },
        },
      ]);

      // Get the total BCX bought, default to 0 if there are no transactions
      const totalBcxBought =
        totalResult.length > 0 ? totalResult[0].totalBcxBought : 0;

      // Calculate the remaining BCX based on the total BCX limit
      const remainingBcx =
        this.config.buybackConfig.totalBcxLimit - totalBcxBought;

      const message = `
          📊 Current Buyback Status:
          • Total BCX Bought: ${totalBcxBought}
          • Remaining BCX: ${remainingBcx}
          • Current Price: $${this.config.buybackConfig.pricePerBcx}
          • Maximum Transaction: ${this.config.buybackConfig.maxSwapSize} BCX
    `;
      await this.telegramBot.sendMessage(chatId, message);
    } catch (e) {
      console.error("Sending out info command", e);
      await this.telegramBot.sendMessage(
        chatId,
        "Error retrieving buyback information."
      );
    }
  }

  async handleAddressSubmission(chatId, address) {
    console.log("starting tx, 1");

    // Store user's USDT address
    this.activeUsers.set(chatId, {
      usdtAddress: address,
      timestamp: Date.now(),
    });

    const message = `
        ✅ Your USDT address has been recorded: ${address}
        You can now send your BCX to:
        ${this.config.botWallet}
        I'll notify you once the transaction is detected and processed.
      `;
    await this.telegramBot.sendMessage(chatId, message);
    console.log("starting tx, 2");
    this.startListening();
  }

  async processBuyback(sender, amount, chatId) {
    try {
      console.log("gotten inside 1");
      const bcxAmount = Number(formatEther(amount));
      if (bcxAmount > this.config.buybackConfig.maxSwapSize) {
        await this.telegramBot.sendMessage(
          chatId,
          "Exceeds maximum swap size, we would send back your bcx"
        );
        console.log("gotten inside 2");

        // Send USDT
        const tx = await this.bcxContract.transfer(
          userData.usdtAddress,
          parseEther(bcxAmount.toString())
        );
        await tx.wait();

        await this.telegramBot.sendMessage(
          chatId,
          "Your Bcx has been sent back"
        );
        return;
      }
      console.log("gotten inside 3");
      const usdtAmount =
        bcxAmount *
        this.config.buybackConfig.pricePerBcx *
        (1 - this.config.buybackConfig.fee);

      const userData = this.activeUsers.get(chatId);
      console.log(4);

      // Check if the address exists in the database and count transactions
      const transactionCount = await this.connection.countDocuments({
        address: sender,
      });
      console.log("gotten inside 5");
      if (transactionCount >= 5) {
        await this.telegramBot.sendMessage(
          chatId,
          "You have passed your swap limit"
        );
        return;
      } else {
        console.log("transfering, 1");
        // Send USDT
        const tx = await this.usdtContract.transfer(
          userData.usdtAddress,
          parseEther(usdtAmount.toString())
        );
        await tx.wait();

        console.log("transfering, 2");

        // Update totals and notify success
        this.totalBcxBought += bcxAmount;

        const message = ` tx: ${tx.hash}, converted: ${bcxAmount} BCX, to ${usdtAmount} USDT,
          `;
        await this.telegramBot.sendMessage(chatId, message);

        // Remove the specific listener
        // this.bcxContract.removeListener("Transfer", transferListener);
        await stopListening();

        // Create a new record for the transaction
        const transaction = new this.connection({
          address: sender,
          bcx_sent: String(bcxAmount),
          usdt_received: String(usdtAmount),
        });
        await transaction.save();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async startListening() {
    console.log("Starting transfer event listener");

    try {
      // Validate contract and wallet
      if (!this.bcxContract) {
        throw new Error("Contract instance is not initialized");
      }
      if (!this.config?.botWallet) {
        throw new Error("Bot wallet address is not defined");
      }

      // Create filter for transfers to bot wallet
      // const filter = this.bcxContract.filters.Transfer(
      //   null,
      //   this.config.botWallet
      // );
      console.log(
        "Transfer filter created for bot wallet:",
        "this.config.botWallet"
      );

      // Add listener using the filter
      this.bcxContract.on("Transfer", async (from, to, amount, event) => {
        console.log(
          `Transfer detected - From: ${from}, Amount: ${ethers.utils.formatEther(
            amount
          )} tokens`
        );

        try {
          // Find associated chat ID for sender's wallet
          const chatId = this.findChatIdByTransaction(from);
          if (!chatId) {
            console.log(`No chat ID found for sender: ${from}`);
            return;
          }

          console.log(`Processing payment for chat ID: ${chatId}`);

          // Notify user
          await this.telegramBot.sendMessage(
            chatId,
            `🔄 Payment detected! Processing ${ethers.utils.formatEther(
              amount
            )} tokens...`
          );

          // Process the buyback
          await this.processBuyback(from, amount, chatId);

          console.log(`Successfully processed payment from ${from}`);
        } catch (innerError) {
          console.error("Payment processing error:", innerError);

          if (chatId) {
            await this.telegramBot.sendMessage(
              chatId,
              "⚠️ Error processing your payment. Please contact support."
            );
          }
        }
      });

      // Add error handler for the contract events
      this.bcxContract.on("error", (error) => {
        console.error("Contract event error:", error);
      });

      console.log("Transfer listener initialized successfully");
    } catch (error) {
      console.error("Failed to start transfer listener:", error);
      throw error;
    }
  }

  // Add cleanup method
  async stopListening() {
    try {
      const filterTo = this.bcxContract.filters.Transfer(
        null,
        this.config.botWallet
      );
      this.bcxContract.removeListener(filterTo);
      console.log("Transfer event listener stopped");
    } catch (error) {
      console.error("Error stopping transfer listener:", error);
    }
  }

  findChatIdByTransaction(address) {
    // Find chatId by matching the transaction sender with stored user sessions
    console.log("you have been called why fuck up", this.activeUsers);
    for (const [chatId, data] of this.activeUsers.entries()) {
      if (data.usdtAddress.toLowerCase() === address.toLowerCase()) {
        console.log("found");
        return chatId;
      }
    }
    return null;
  }

  getStatus() {
    return {
      isActive: this.isActive,
      totalBcxBought: this.totalBcxBought,
      remainingBcx:
        this.config.buybackConfig.totalBcxLimit - this.totalBcxBought,
      config: this.config.buybackConfig,
    };
  }
}

module.exports = { BuybackBot };
