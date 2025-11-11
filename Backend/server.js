const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Redis clients for pub/sub
const pubClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

const subClient = pubClient.duplicate();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    server: process.env.SERVER_ID || 'unknown',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint for "GET /"
app.get('/', (req, res) => {
  res.send('Backend running!');
});

// API endpoints
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await pubClient.sMembers('chat:rooms');
    const roomDetails = await Promise.all(
      rooms.map(async (room) => {
        const members = await pubClient.sCard(`chat:room:${room}:members`);
        return { id: room, name: room, memberCount: members };
      })
    );
    res.json(roomDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Store active users
const activeUsers = new Map();

async function initializeRedis() {
  try {
    await pubClient.connect();
    await subClient.connect();
    // Set up Redis adapter for Socket.IO
    io.adapter(createAdapter(pubClient, subClient));
    console.log(' Redis connected successfully');
    console.log(` Server ID: ${process.env.SERVER_ID || 'unknown'}`);
  } catch (error) {
    console.error(' Redis connection error:', error);
    process.exit(1);
  }
}

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`👤 User connected: ${socket.id}`);
  // ... (rest of your socket.io code unchanged)
});

// Start server
const PORT = process.env.PORT || 3100;

initializeRedis().then(() => {
  server.listen(PORT, () => {
    console.log(` Server running on port ${PORT}`);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await pubClient.quit();
  await subClient.quit();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
