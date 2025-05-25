# Use an official Node.js lts version
FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Use --omit=dev for production builds to reduce image size
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the application
CMD ["node", "src/server.js"]