const { BuybackBot } = require('../services/BuybackBot');
const TelegramBot = require('node-telegram-bot-api');
const {Web3, WebSocketProvider} = require('web3');

describe('BuybackBot processBuyback', () => {
  let buybackBot;
  let mockConfig;
  let mockConnection;
  let mockTelegramBot;

  beforeEach(() => {
    // Mock dependencies
    mockTelegramBot = {
      sendMessage: jest.fn().mockResolvedValue(true)
    };

    mockConfig = {
      botWallet: '0x52b294eC2dDA65876471748aB0E42Ee6364e6e4F',
      buybackConfig: {
        pricePerBcx: 0.5,
        maxSwapSize: 1000,
        fee: 0.1,
        totalBcxLimit: 10000
      },
      telegramBotToken: 'fake-token'
    };

    mockConnection = {
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue([]),
      prototype: {
        save: jest.fn().mockResolvedValue(true)
      }
    };

    // Mock Web3 and contract methods
    const mockWeb3 = {
      utils: {
        fromWei: jest.fn((amount) => {
          // Convert from Wei to BCX tokens
          return (BigInt(amount) / BigInt(10 ** 18)).toString()
        }),
        toWei: jest.fn((amount) => {
          // Convert to Wei 
          return (BigInt(Math.floor(parseFloat(amount) * 10 ** 18))).toString()
        }),
        isAddress: jest.fn().mockReturnValue(true)
      }
    };

    // Partially mock the BuybackBot constructor
    buybackBot = new BuybackBot(mockConfig, mockConnection);
    
    // Override some methods for testing
    buybackBot.telegramBot = mockTelegramBot;
    buybackBot.web3 = mockWeb3;

    // Mock contract methods
    buybackBot.bcxContract = {
      methods: {
        transfer: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue({ transactionHash: 'mock-tx-hash' })
        })
      }
    };

    buybackBot.usdtContract = {
      methods: {
        balanceOf: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue('1000000000000000000000') // Sufficient balance
        }),
        transfer: jest.fn().mockReturnValue({
          send: jest.fn().mockResolvedValue({ transactionHash: 'mock-tx-hash' })
        })
      }
    };

    // Setup active user
    buybackBot.activeUsers = new Map();
    buybackBot.activeUsers.set(12345, {
      usdtAddress: '0xce8812DB3022B69fE79680bBD260afbD4965E297',
      timestamp: Date.now()
    });
  });

  it('should process buyback successfully', async () => {
    // Simulate the event data you received
    const sender = '0xce8812DB3022B69fE79680bBD260afbD4965E297';
    const amount = BigInt('1000000000000000000'); // 1 BCX
    const chatId = 12345;

    await buybackBot.processBuyback(sender, amount, chatId);

    // Assertions
    expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
      chatId, 
      expect.stringContaining('Transaction: mock-tx-hash')
    );

    // Verify that transfer methods were called
    expect(buybackBot.usdtContract.methods.transfer).toHaveBeenCalled();
    
    // Verify that the transaction was saved
    expect(mockConnection.prototype.save).toHaveBeenCalled();

    // Verify that the active user was removed
    expect(buybackBot.activeUsers.has(chatId)).toBeFalsy();
  });

  it('should handle max swap size exceeded', async () => {
    // Simulate an amount larger than max swap size
    const sender = '0xce8812DB3022B69fE79680bBD260afbD4965E297';
    const amount = BigInt('2000000000000000000'); // 2 BCX
    const chatId = 12345;

    await buybackBot.processBuyback(sender, amount, chatId);

    // Assertions
    expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
      chatId, 
      'Exceeds maximum swap size, we would send back your BCX'
    );

    // Verify that BCX transfer back method was called
    expect(buybackBot.bcxContract.methods.transfer).toHaveBeenCalledWith(
      sender, 
      amount.toString()
    );
  });

  it('should handle insufficient bot balance', async () => {
    // Mock insufficient balance
    buybackBot.usdtContract.methods.balanceOf = jest.fn().mockReturnValue({
      call: jest.fn().mockResolvedValue('0') // Zero balance
    });

    const sender = '0xce8812DB3022B69fE79680bBD260afbD4965E297';
    const amount = BigInt('1000000000000000000'); // 1 BCX
    const chatId = 12345;

    await buybackBot.processBuyback(sender, amount, chatId);

    // Assertions
    expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
      chatId, 
      'Insufficient USDT balance in bot wallet. Contact admin for refund'
    );
  });
});