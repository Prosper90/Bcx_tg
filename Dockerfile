# Use Node.js LTS version
FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install PM2 globally
RUN npm install pm2 -g

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create a healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Create PM2 ecosystem file
RUN echo '{\
  "apps": [{\
    "name": "websocket-app",\
    "script": "src/server.js",\
    "instances": 1,\
    "exec_mode": "fork",\
    "watch": false,\
    "max_memory_restart": "1G",\
    "env": {\
      "NODE_ENV": "production"\
    }\
  }]\
}' > ecosystem.config.json

# Start PM2
CMD ["pm2-runtime", "start", "ecosystem.config.json"]