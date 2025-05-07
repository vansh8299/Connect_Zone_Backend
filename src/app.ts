// server setup file (updated)
import dotenv from 'dotenv';
import { connectGraphQL } from './graphql/graphql';
import { Server } from 'http';
import { Server as SocketServer } from 'socket.io';

dotenv.config({ path: './.env' });

export const envMode = process.env.NODE_ENV?.trim() || 'DEVELOPMENT';
const port = parseInt(process.env.PORT || '4000');
const uri = process.env.GRAPHQL_URI || 'graphql';

// Global socket.io instance
export let io: SocketServer;

const startServer = async () => {
  try {
    const { httpServer } = await connectGraphQL({
      port,
      path: uri,
      env: envMode
    });
    
    // Initialize Socket.IO
    io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      }
    });
    
    // Socket.IO connection handler
  // In your server setup file
// In your server setup
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  const token = socket.handshake.auth.token;
  if (!token) {
    socket.disconnect();
    return;
  }

  try {
    // Decode token to get userId
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
    const userId = payload.userId;
    
    if (!userId) {
      socket.disconnect();
      return;
    }

    // Join user to their personal room
    socket.join(userId);
    
    // Handle joining conversation rooms
    socket.on('joinConversation', (conversationId) => {
      socket.join(conversationId);
      console.log(`User ${userId} joined conversation ${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on('leaveConversation', (conversationId) => {
      socket.leave(conversationId);
      console.log(`User ${userId} left conversation ${conversationId}`);
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected`);
    });

  } catch (error) {
    console.error('Socket connection error:', error);
    socket.disconnect();
  }
})} catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();