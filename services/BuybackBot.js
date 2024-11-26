// src/services/BuybackBot.js
const { ethers, formatEther, parseEther } = require("ethers");
const TelegramBot = require("node-telegram-bot-api");
// const { formatEther, parseEther } = ethers.utils;
const TokenABI = require("../utils/TokenABI.json");
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
    this.provider = new ethers.WebSocketProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Initialize contracts
    this.bcxContract = new ethers.Contract(
      config.bcxAddress,
      TokenABI,
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
    2. Share your USDT wallet address with me

    Your transaction will be processed automatically and you'll receive notifications about the status.

    Use /info to see bcx buyback info.
`;
    await this.telegramBot.sendMessage(chatId, message);
  }

  async handleInfoCommand(chatId) {
      try {
          
        // const status = this.getStatus();
        // Query the database to calculate the total BCX bought (sum of bcx_sent)
        const [rows] = await this.connection.query(
          "SELECT SUM(CAST(bcx_sent AS UNSIGNED)) AS totalBcxBought FROM transactions"
        );
        
        // Get the total BCX bought, default to 0 if there are no transactions
        const totalBcxBought = rows[0].totalBcxBought || 0;
    
        // Calculate the remaining BCX based on the total BCX limit
        const remainingBcx = this.config.buybackConfig.totalBcxLimit - totalBcxBought;
    
        const message = `
          📊 Current Buyback Status:
          • Total BCX Bought: ${totalBcxBought}
          • Remaining BCX: ${remainingBcx}
          • Current Price: $${this.config.buybackConfig.pricePerBcx}
          • Maximum Transaction: ${this.config.buybackConfig.maxSwapSize} BCX
    `;
        await this.telegramBot.sendMessage(chatId, message);
      } catch(e) {
          console.error("Sending out info command", e);
          await this.telegramBot.sendMessage(chatId, "Error retrieving buyback information.");
      }
  }

  async handleAddressSubmission(chatId, address) {
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
    this.startListening();
  }

  async processBuyback(sender, amount, chatId) {
    try {
        
        const bcxAmount = Number(formatEther(amount));
        if (bcxAmount > this.config.buybackConfig.maxSwapSize) {
              await this.telegramBot.sendMessage(chatId, "Exceeds maximum swap size, we would send back your bcx");
            
              // Send USDT
              const tx = await this.bcxContract.transfer(userData.usdtAddress, parseEther(bcxAmount.toString()));
              await tx.wait();
              
              await this.telegramBot.sendMessage(chatId, "Your Bcx has been sent back");
           return;
        }
        
        const usdtAmount = bcxAmount * this.config.buybackConfig.pricePerBcx * (1 - this.config.buybackConfig.fee);
          
        const userData = this.activeUsers.get(chatId);
        console.error(4);
        
        // Check if the address exists in the database
        const [rows] = await this.connection.query(
          "SELECT COUNT(*) AS count FROM transactions WHERE address = ?",
          [sender]
        );
        
       const addressCount = rows[0].count;
        

        if (addressCount >= 5) {
         await this.telegramBot.sendMessage(chatId, "You have passed your swap limit");
         return;
        } else {
        
          // Send USDT
          const tx = await this.usdtContract.transfer(userData.usdtAddress, parseEther(usdtAmount.toString()));
          await tx.wait();
    
          // Update totals and notify success
          this.totalBcxBought += bcxAmount;
    
          const message = ` tx: ${tx.hash}, converted: ${bcxAmount} BCX, to ${usdtAmount} USDT,
          `;
          await this.telegramBot.sendMessage(chatId, message);
          
          // Remove the specific listener
          this.bcxContract.removeListener("Transfer", transferListener);
          
        // Create a new record for the user
          await this.connection.query(
            "INSERT INTO transactions (address, bcx_sent, usdt_recieved) VALUES (?, ?, ?)",
            [sender, String(bcxAmount), String(usdtAmount)]
          );
        }
        
    } catch (error) {
      console.error(error);
    }
  }

  async startListening() {
    this.bcxContract.on("Transfer", async (from, to, amount, event) => {
      if (to.toLowerCase() !== this.config.botWallet.toLowerCase()) return;
      console.log(from, "checking the sender");
      // Find associated chatId from stored sessions
      const chatId = this.findChatIdByTransaction(from);
      if (!chatId) return;

      try {
        const message = `🔄 Payment detected, processinig`;
        await this.telegramBot.sendMessage(chatId, message);
        await this.processBuyback(from, amount, chatId);
      } catch (error) {
        console.error("Error processing buyback:", error);
      }
    });

    // const topic = ethers.utils.id("Transfer(address,address,uint256)");

    // provider.on(
    //   {
    //     address: this.bcxContract.address, // Contract address
    //     topics: [topic], // Topic for Transfer event
    //   },
    //   async (log) => {
    //     const parsedLog = this.bcxContract.interface.parseLog(log);
    //     const { from, to, amount } = parsedLog.args;

    //     if (to.toLowerCase() !== this.config.botWallet.toLowerCase()) return;

    //     const chatId = this.findChatIdByTransaction(from);
    //     if (!chatId) return;

    //     try {
    //       const message = `🔄 Payment detected, processinig`;
    //       await this.telegramBot.sendMessage(chatId, message);
    //       await this.processBuyback(from, amount, chatId);
    //     } catch (error) {
    //       console.error("Error processing buyback:", error);
    //     }
    //   }
    // );
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
