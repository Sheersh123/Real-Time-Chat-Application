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
  
  // User joins with username
  socket.on('user:join', async ({ username, room }) => {
    try {
      const userId = uuidv4();
      
      activeUsers.set(socket.id, {
        id: userId,
        username,
        room,
        joinedAt: new Date()
      });
      
      // Join room
      socket.join(room);
      
      // Add to Redis
      await pubClient.sAdd('chat:rooms', room);
      await pubClient.sAdd(`chat:room:${room}:members`, socket.id);
      
      // Get room member count
      const memberCount = await pubClient.sCard(`chat:room:${room}:members`);
      
      // Notify room
      io.to(room).emit('user:joined', {
        username,
        memberCount,
        timestamp: new Date().toISOString()
      });
      
      // Send join confirmation
      socket.emit('user:join:success', {
        userId,
        room,
        memberCount
      });
      
      console.log(` ${username} joined room: ${room}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  // Handle chat messages
  socket.on('message:send', async ({ message, room }) => {
    try {
      const user = activeUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }
      
      const messageData = {
        id: uuidv4(),
        userId: user.id,
        username: user.username,
        message,
        room,
        timestamp: new Date().toISOString()
      };
      
      // Store message in Redis (last 100 messages per room)
      await pubClient.lPush(
        `chat:room:${room}:messages`,
        JSON.stringify(messageData)
      );
      await pubClient.lTrim(`chat:room:${room}:messages`, 0, 99);
      
      // Broadcast to room
      io.to(room).emit('message:received', messageData);
      
      console.log(` Message in ${room} from ${user.username}: ${message}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  // Handle typing indicator
  socket.on('typing:start', ({ room }) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(room).emit('typing:user', {
        username: user.username,
        isTyping: true
      });
    }
  });
  
  socket.on('typing:stop', ({ room }) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.to(room).emit('typing:user', {
        username: user.username,
        isTyping: false
      });
    }
  });
  
  // Get message history
  socket.on('messages:history', async ({ room }) => {
    try {
      const messages = await pubClient.lRange(`chat:room:${room}:messages`, 0, -1);
      const parsedMessages = messages.reverse().map(msg => JSON.parse(msg));
      socket.emit('messages:history:success', parsedMessages);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    
    if (user) {
      try {
        // Remove from Redis
        await pubClient.sRem(`chat:room:${user.room}:members`, socket.id);
        const memberCount = await pubClient.sCard(`chat:room:${user.room}:members`);
        
        // Notify room
        io.to(user.room).emit('user:left', {
          username: user.username,
          memberCount,
          timestamp: new Date().toISOString()
        });
        
        activeUsers.delete(socket.id);
        console.log(` ${user.username} left room: ${user.room}`);
      } catch (error) {
        console.error('Error during disconnect:', error);
      }
    }
    
    console.log(` User disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3001;

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
