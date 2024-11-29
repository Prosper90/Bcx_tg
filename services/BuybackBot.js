const TelegramBot = require("node-telegram-bot-api");
const { Web3, WebSocketProvider } = require("web3");
const TokenABI = require("../utils/TokenABI.json");
const BcxABI = require("../utils/BcxABI.json");
// const { WebSocketProvider } = require("web3-providers-ws");

class BuybackBot {
  constructor(config, connection) {
    this.config = config;
    this.connection = connection;
    this.activeUsers = new Map();
    this.totalBcxBought = 0;
    this.isActive = false;
    this.chain = config.chain || "Unknown"; // Added chain identifier

    // Initialize Web3 with WebSocket Provider
    this.provider = new WebSocketProvider(
      config.rpcUrl,
      {},
      {
        autoReconnect: true,
        delay: 10000,
        maxAttempts: 10,
      }
    );

    this.provider.on("connect", () => {
      console.log(`Connected to ${this.chain} websocket provider`);
    });

    this.provider.on("disconnect", (error) => {
      console.error(`Closed ${this.chain} webSocket connection`, error);
    });

    this.web3 = new Web3(this.provider);

    // Create account from private key
    this.account = this.web3.eth.accounts.privateKeyToAccount(
      `0x${config.privateKey}`
    );
    this.web3.eth.accounts.wallet.add(this.account);

    // Initialize contracts
    this.bcxContract = new this.web3.eth.Contract(BcxABI, config.bcxAddress);
    this.usdtContract = new this.web3.eth.Contract(
      TokenABI,
      config.usdtAddress
    );

    // Initialize Telegram bot
    this.telegramBot = new TelegramBot(config.telegramBotToken, {
      polling: true,
    });

    // Setup bot commands and event subscriptions
    this.setupBotCommands();
    this.setupEventSubscriptions();
  }

  async setupEventSubscriptions() {
    try {
      // Subscribe to Transfer events for the bot's wallet
      await this.subscribeToEvent(this.chain, this.bcxContract, "Transfer", {
        to: this.config.botWallet,
      });
    } catch (error) {
      console.error("Error setting up event subscriptions:", error);
    }
  }

  async subscribeToEvent(chain, contract, eventName, filter = {}) {
    try {
      const subscription = contract.events[eventName]({ filter });

      subscription.on("connected", (subscriptionId) => {
        console.log(`${chain} BCX '${eventName}' SubID:`, subscriptionId);
      });

      subscription.on("data", async (event) => {
        // console.log(`${chain} BCX '${eventName}'`, JSON.stringify({
        //   from: event.returnValues.from,
        //   to: event.returnValues.to,
        //   value: event.returnValues.value
        // }));

        console.log(event, "checking the event");

        // Process buyback for transfers to bot wallet
        if (
          event.returnValues.to.toLowerCase() ===
          this.config.botWallet.toLowerCase()
        ) {
          const chatId = this.findChatIdByTransaction(event.returnValues.from);
          if (!chatId) return;

          await this.telegramBot.sendMessage(
            chatId,
            "🔄 Payment detected, processing"
          );

          // Ensure `value` exists before passing it to `processBuyback`
          if (!event.returnValues.value) {
            console.error("Missing value in event:", event);
            await this.telegramBot.sendMessage(
              chatId,
              "Error: Payment value missing in the event."
            );
            return;
          }

          await this.processBuyback(
            event.returnValues.from,
            event.returnValues.value,
            chatId
          );
        }
      });

      subscription.on("changed", (event) => {
        console.log("Removed event from local database:", event);
      });

      subscription.on("error", (error) => {
        console.error(`${chain} BCX '${eventName}' error:`, error);
      });

      return subscription;
    } catch (error) {
      console.error(`Error subscribing to ${eventName} event:`, error);
      throw error;
    }
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
        if (this.web3.utils.isAddress(text)) {
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
    1. Share your de-centralized wallet address with me here
    2. Send your BCX to: ${this.config.botWallet}

    Your transaction will be processed automatically and you'll receive notifications about the status.

    Use /info to see bcx buyback info.
`;
    await this.telegramBot.sendMessage(chatId, message);
  }

  async handleInfoCommand(chatId) {
    try {
      const totalResult = await this.connection.aggregate([
        {
          $group: {
            _id: null,
            totalBcxBought: { $sum: { $toDouble: "$bcx_sent" } },
          },
        },
      ]);

      const totalBcxBought =
        totalResult.length > 0 ? totalResult[0].totalBcxBought : 0;
      const remainingBcx =
        this.config.buybackConfig.totalBcxLimit - totalBcxBought;

      const message = `
📊 Current Buyback Status:
• Total BCX Bought: ${totalBcxBought}
• Remaining BCX: ${remainingBcx}
• Current Price: $${this.config.buybackConfig.pricePerBcx}
• Maximum Transaction: ${this.config.buybackConfig.maxSwapSize} BCX`;

      await this.telegramBot.sendMessage(chatId, message);
    } catch (error) {
      console.error("Error sending info command:", error);
      await this.telegramBot.sendMessage(
        chatId,
        "Error retrieving buyback information."
      );
    }
  }

  async handleAddressSubmission(chatId, address) {
    this.activeUsers.set(chatId, {
      usdtAddress: address,
      timestamp: Date.now(),
    });

    const message = `
  ✅ Your USDT address has been recorded: ${address}
  You can now send your BCX to:
  ${this.config.botWallet}
  I'll notify you once the transaction is detected and processed.`;

    await this.telegramBot.sendMessage(chatId, message);
    // await this.startListening();
  }

  async processBuyback(sender, amountConv, chatId) {
    // Validate amount
    // if (!amount || isNaN(amount)) {
    //     console.error("Invalid amount received:", amount);
    //     await this.telegramBot.sendMessage(
    //         chatId,
    //         "Error: Received invalid payment amount."
    //     );
    //     return;
    // }

    const amount = String(amountConv).replace(/n$/, "");

    console.log(1);
    // const bcxAmount = Number(this.web3.utils.fromWei(amount));
    const bcxAmount = Number(amount) / 10 ** 18;
    console.log(2, bcxAmount);
    if (bcxAmount > this.config.buybackConfig.maxSwapSize) {
      await this.telegramBot.sendMessage(
        chatId,
        "100000 bcx has been bought back already, we would send back your BCX"
      );
      console.log(3);
      const tx = await this.bcxContract.methods
        .transfer(sender, amount)
        .send({ from: this.account.address, gas: 200000 });
      console.log(4);
      await this.telegramBot.sendMessage(chatId, "Your BCX has been sent back");
      return;
    }
    console.log(4);
    // const usdtAmount =
    //   bcxAmount *
    //   this.config.buybackConfig.pricePerBcx *
    //   (1 - this.config.buybackConfig.fee);
    const userData = this.activeUsers.get(chatId);
    console.log(6);
    const transactionCount = await this.connection.countDocuments({
      address: sender,
    });
    console.log(7);
    if (transactionCount >= 5) {
      await this.telegramBot.sendMessage(
        chatId,
        "You have passed your swap limit your bcx would be sent back to you"
      );
      return;
    }
    console.log(9);
    const botBalance = await this.usdtContract.methods
      .balanceOf(this.config.botWallet)
      .call();
    console.log(10);
    const OnebcxPrice = 0.148;
    const bcxAmountToUsdt = bcxAmount * OnebcxPrice;

    const usdtAmount =
      bcxAmountToUsdt *
      this.config.buybackConfig.pricePerBcx *
      (1 - this.config.buybackConfig.fee);

    console.log(bcxAmountToUsdt, usdtAmount, "lively doingssss");
    if (bcxAmountToUsdt > botBalance) {
      await this.telegramBot.sendMessage(
        chatId,
        "Insufficient USDT balance in bot wallet. Contact admin for refund"
      );
      return;
    }
    console.log(11);

    // First estimate the gas to ensure the transaction is valid
    // const gasEstimate = await this.usdtContract.methods
    //   .transfer(userData.usdtAddress, usdtAmount * 10 ** 18)
    //   .estimateGas({ from: this.account.address });

    // // Add 20% buffer to gas estimate
    // const gasLimit = Math.round(gasEstimate * 1.2);

    const tx = await this.usdtContract.methods
      .transfer(userData.usdtAddress, bcxAmountToUsdt * 10 ** 18)
      .send({ from: this.account.address, gas: 300000 });

    // const tx = await this.usdtContract.methods
    //   .transfer(userData.usdtAddress, usdtAmount * 10 ** 18)
    //   .send({
    //     from: this.account.address,
    //     gas: gasLimit,
    //     maxFeePerGas: null, // Let Web3 calculate this
    //     maxPriorityFeePerGas: null, // Let Web3 calculate this
    //   });

    console.log(12);
    this.totalBcxBought += bcxAmount;
    console.log(13);
    const message = `Transaction: ${tx.transactionHash}
        Converted: ${bcxAmount} BCX to ${usdtAmount} USDT
        Status: Successful`;
    console.log(14);
    await this.telegramBot.sendMessage(chatId, message);
    console.log(15);
    const transaction = new this.connection({
      address: sender,
      bcx_sent: String(bcxAmount),
      usdt_received: String(usdtAmount),
    });
    await transaction.save();
    console.log(16);
    this.activeUsers.delete(chatId);
    console.log(20);
  }

  async startListening() {
    try {
      console.log(1);

      if (!this.bcxContract) {
        throw new Error("Contract not initialized");
      }
      console.log(2);
      // Additional null check before calling .on()
      if (this.bcxContract && typeof this.bcxContract.events === "object") {
        console.log(3);
        const CheckOut = this.bcxContract.events.Transfer({
          filter: { to: this.config.botWallet },
        });
        console.log(4);
        if (CheckOut) {
          CheckOut.on("data", async (event) => {
            console.log("Filtered Transfer Event:", event);
            const chatId = this.findChatIdByTransaction(
              event.returnValues.from
            );
            if (!chatId) return;
            console.log(5);
            await this.telegramBot.sendMessage(
              chatId,
              "🔄 Payment detected, processing"
            );
            await this.processBuyback(
              event.returnValues.from,
              event.returnValues.value,
              chatId
            );
          }).on("error", (error) => {
            console.error("Event Listener Error:", error);
          });
          console.log(6);
        }
      } else {
        console.error("Contract events are not available");
      }
    } catch (error) {
      console.error("Error starting transfer listener:", error);
    }
  }

  findChatIdByTransaction(address) {
    for (const [chatId, data] of this.activeUsers.entries()) {
      if (data.usdtAddress.toLowerCase() === address.toLowerCase()) {
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
