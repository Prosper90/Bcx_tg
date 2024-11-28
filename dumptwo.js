const TelegramBot = require("node-telegram-bot-api");
const Web3 = require("web3");
const TokenABI = require("../utils/TokenABI.json");
const BcxABI = require("../utils/BcxABI.json");

class BuybackBot {
  constructor(config, connection) {
    this.config = config;
    this.connection = connection;
    this.activeUsers = new Map();
    this.totalBcxBought = 0;
    this.isActive = false;

    // Initialize Web3
    // this.web3 = new Web3(new Web3.providers.WebsocketProvider(config.rpcUrl));
    // Create multiple provider instances
    this.provider = new WebSocketProvider(
      config.rpcUrl,
      {},
      {
        autoReconnect: true,
        delay: 10000, // Default: 5000 ms
        maxAttempts: 10, // Default: 5
      },
    );

    this.provider.on('connect', () => {
      console.log(`Connected to ${chain} websocket provider`);
    });
  
    this.provider.on('disconnect', error => {
      console.error(`Closed ${chain} webSocket connection`, error);
    });

    this.web3 = new Web3(this.provider);
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

    await this.subscribeToEvent(chain, this.bcxContract, 'Transfer');
    // await subscribeToEvent(chain, contract, 'Approval');

    // Initialize Telegram bot
    this.telegramBot = new TelegramBot(config.telegramBotToken, {
      polling: true,
    });
    this.setupBotCommands();
  }


  async subscribeToEvent(chain, contract, eventName) => {
    const subscription = await contract.events[eventName]();
  
    subscription.on('connected', subscriptionId => {
      console.log(`${chain} BCX '${eventName}' SubID:`, subscriptionId);
    });
  
    subscription.on('data', event => {
      console.log(`${chain} BCX '${eventName}'`, JSON.stringify({ event })); // cannot json.stringify BigInt...
    });
  
    subscription.on('changed', event => {
      // Remove event from local database
      console.log("Remove from database")
      
    });
  
    subscription.on('error', error => {
      console.error(`${chain} BCX '${eventName}' error:`, error);
    });
  };

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
    1. Send your BCX to: ${this.config.botWallet}
    2. Share your USDT wallet address with me here

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
    await this.startListening();
  }

  async processBuyback(sender, amount, chatId) {
    try {
      const bcxAmount = Number(this.web3.utils.fromWei(amount));

      if (bcxAmount > this.config.buybackConfig.maxSwapSize) {
        await this.telegramBot.sendMessage(
          chatId,
          "Exceeds maximum swap size, we would send back your BCX"
        );

        const tx = await this.bcxContract.methods
          .transfer(sender, amount)
          .send({ from: this.account.address, gas: 200000 });

        await this.telegramBot.sendMessage(
          chatId,
          "Your BCX has been sent back"
        );
        return;
      }

      const usdtAmount =
        bcxAmount *
        this.config.buybackConfig.pricePerBcx *
        (1 - this.config.buybackConfig.fee);
      const userData = this.activeUsers.get(chatId);

      const transactionCount = await this.connection.countDocuments({
        address: sender,
      });

      if (transactionCount >= 5) {
        await this.telegramBot.sendMessage(
          chatId,
          "You have passed your swap limit"
        );
        return;
      }

      const botBalance = await this.usdtContract.methods
        .balanceOf(this.config.botWallet)
        .call();

      if (this.web3.utils.toWei(usdtAmount.toString()) > botBalance) {
        await this.telegramBot.sendMessage(
          chatId,
          "Insufficient USDT balance in bot wallet. Contact admin for refund"
        );
        return;
      }

      const tx = await this.usdtContract.methods
        .transfer(
          userData.usdtAddress,
          this.web3.utils.toWei(usdtAmount.toString())
        )
        .send({ from: this.account.address, gas: 200000 });

      this.totalBcxBought += bcxAmount;

      const message = `Transaction: ${tx.transactionHash}
Converted: ${bcxAmount} BCX to ${usdtAmount} USDT
Status: Successful`;

      await this.telegramBot.sendMessage(chatId, message);

      const transaction = new this.connection({
        address: sender,
        bcx_sent: String(bcxAmount),
        usdt_received: String(usdtAmount),
      });
      await transaction.save();

      this.activeUsers.delete(chatId);
    } catch (error) {
      console.error("Error processing buyback:", error);
      await this.telegramBot.sendMessage(
        chatId,
        "Error processing transaction. Please contact support."
      );
    }
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
