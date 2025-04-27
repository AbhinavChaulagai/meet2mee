const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active connections
const rooms = {};
const userSocketMap = {};

// API endpoint to get active rooms
app.get('/api/rooms', (req, res) => {
  res.json({
    rooms: Object.keys(rooms).map(roomId => ({
      id: roomId,
      users: Object.keys(rooms[roomId].users).length
    }))
  });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining a room
  socket.on('join-room', ({ roomId, userId }) => {
    // Create a new room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        users: {},
        messages: []
      };
    }

    // Add user to the room
    rooms[roomId].users[userId] = {
      id: userId,
      socketId: socket.id
    };
    
    // Map socket to user
    userSocketMap[socket.id] = {
      userId,
      roomId
    };

    // Join the socket room
    socket.join(roomId);
    
    // Notify other users in the room
    socket.to(roomId).emit('user-connected', { userId });
    
    // Send current users to the new user
    const usersInRoom = Object.keys(rooms[roomId].users).filter(id => id !== userId);
    socket.emit('room-users', { users: usersInRoom });
    
    // Send chat history to the new user
    socket.emit('chat-history', { messages: rooms[roomId].messages });
    
    console.log(`User ${userId} joined room ${roomId}`);
  });

  // Handle WebRTC signaling
  socket.on('signal', ({ userId, targetUserId, signal }) => {
    const userInfo = userSocketMap[socket.id];
    if (!userInfo) return;
    
    const { roomId } = userInfo;
    const room = rooms[roomId];
    
    if (!room) return;
    
    const targetUser = Object.values(room.users).find(user => user.id === targetUserId);
    if (!targetUser) return;
    
    io.to(targetUser.socketId).emit('signal', {
      userId,
      signal
    });
  });

  // Handle chat messages
  socket.on('send-message', ({ message, roomId, userId, timestamp }) => {
    if (!rooms[roomId]) return;
    
    const newMessage = {
      id: uuidv4(),
      userId,
      message,
      timestamp
    };
    
    // Store message in room history
    rooms[roomId].messages.push(newMessage);
    
    // Limit message history to last 100 messages
    if (rooms[roomId].messages.length > 100) {
      rooms[roomId].messages.shift();
    }
    
    // Broadcast message to all users in the room
    io.to(roomId).emit('new-message', newMessage);
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    const userInfo = userSocketMap[socket.id];
    if (!userInfo) return;
    
    const { userId, roomId } = userInfo;
    
    if (rooms[roomId]) {
      // Remove user from room
      delete rooms[roomId].users[userId];
      
      // Notify other users
      socket.to(roomId).emit('user-disconnected', { userId });
      
      // Remove room if empty
      if (Object.keys(rooms[roomId].users).length === 0) {
        delete rooms[roomId];
      }
    }
    
    // Remove from socket map
    delete userSocketMap[socket.id];
    
    console.log(`User disconnected: ${socket.id}`);
  });
});


// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
