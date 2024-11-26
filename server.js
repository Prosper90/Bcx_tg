// src/server.js
const express = require("express");
const config = require("./config");
const { BuybackBot } = require("./services/BuybackBot");
const { setupWebhook } = require("./utils/setup-webhook");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());



// Function to connect to the MySQL database
const connectToDatabase = async () => {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'tradalak_newbot',
      password: 'TelegramNewBot3*',
      database: 'tradalak_tgapp',
    });
    console.log("Connected to the MySQL database.");
    return connection; // Return connection for further use
  } catch (error) {
    console.error("Error connecting to the database:", error.message);
    process.exit(1); // Exit if database connection fails
  }
};


// Function to create the table if it doesn't exist
const createTable = async (connection) => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      address VARCHAR(255) NOT NULL,
      bcx_sent VARCHAR(255) NOT NULL,
      usdt_recieved VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `;

  try {
    await connection.query(createTableQuery);
    console.log("Table 'transactions' ensured to exist.");
  } catch (error) {
    console.error("Error creating table:", error.message);
  }
};

// Start bot operations
// bot.startListening();

// Basic health check endpoint
app.get("/health", (req, res) => {
  console.error("Checking the cronjob");
  res.json({ status: "healthy" });
});

// Start server and optionally setup webhook
const startServer = async () => {
  const ngrokUrl = config.ngrok_url; // Use .env for the ngrok URL
  if (!ngrokUrl) {
    console.error("NGROK_URL is not set in .env");
    process.exit(1);
  }

  try {
    console.error("Setting up webhook...");
    await setupWebhook(ngrokUrl);
    console.error("Webhook setup completed.");
  } catch (error) {
    console.error("Error setting up webhook:", error.message);
  }

   // Connect to the database and ensure the table exists
  const connection = await connectToDatabase();
  await createTable(connection);
  
  // Initialize BuybackBot with the connection
  const buybackBot = new BuybackBot(config, connection);

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

startServer();
