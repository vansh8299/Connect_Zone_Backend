// server/src/socket.ts
import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { PrismaClient } from '@prisma/client';
import cookie from 'cookie';

const prisma = new PrismaClient();

export const initializeSocket = (httpServer: HttpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    },
    transports: ['websocket', 'polling']
  });

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    console.log("Socket connection attempt");
    
    // Extract token from headers or cookies
    const authHeader = socket.handshake.auth.token;
    const cookies = cookie.parse(socket.request.headers.cookie || "");
    const token = authHeader || cookies.token;
    
    console.log("Token found:", token ? 'Yes' : 'No');
    
    // For development, allow connections without tokens
    if (!token && process.env.NODE_ENV !== "PRODUCTION") {
      console.log("No token, but allowing connection in development mode");
      socket.data.authenticated = false;
      return next();
    }
    
    if (!token) {
      console.log("No token provided, rejecting connection");
      return next(new Error("Authentication required"));
    }
    
    try {
      // Decode token to get userId
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
      const userId = payload.userId;
      
      if (!userId) {
        console.log("Invalid token: No userId found");
        return next(new Error("Invalid authentication"));
      }
      
      socket.data.userId = userId;
      socket.data.authenticated = true;
      console.log(`Socket authenticated successfully: User ${userId}`);
      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Invalid authentication"));
    }
  });

  // Socket.IO connection handler
  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    console.log(`Client connected: ${socket.id}, User: ${userId || 'Guest'}`);
    
    // Join the user to their personal room for direct messages
    if (userId) {
      socket.join(userId);
      console.log(`User ${userId} joined personal room`);
      
      // Join all conversations this user is part of
      try {
        const conversations = await prisma.conversationParticipant.findMany({
          where: { userId },
          select: { conversationId: true }
        });
        
        conversations.forEach(({ conversationId }: any) => {
          socket.join(conversationId);
          console.log(`User ${userId} joined conversation ${conversationId}`);
        });
      } catch (error) {
        console.error('Error joining conversation rooms:', error);
      }
    }

    // Handle explicit conversation joining
    socket.on("joinConversation", (conversationId) => {
      if (!conversationId) return;
      
      socket.join(conversationId);
      console.log(`User ${userId} explicitly joined conversation ${conversationId}`);
      
      // Notify the room that a user joined (optional)
      socket.to(conversationId).emit("userJoined", {
        userId: userId,
        timestamp: new Date().toISOString()
      });
    });

    // Handle explicit conversation leaving
    socket.on("leaveConversation", (conversationId) => {
      if (!conversationId) return;
      
      socket.leave(conversationId);
      console.log(`User ${userId} left conversation ${conversationId}`);
    });

    // Handle message sending (for direct socket-based messages)
    socket.on("message", (data) => {
      console.log(`Message from ${socket.id}:`, data);
      
      // Validate data
      if (!data || !data.conversationId) {
        console.error("Invalid message data:", data);
        return;
      }
      
      // Broadcast to everyone in the conversation EXCEPT the sender
      socket.to(data.conversationId).emit("message", {
        type: 'NEW_MESSAGE',
        payload: data
      });
      
      // Also broadcast to receivers' personal rooms if they're not in the conversation room
      if (data.receivers && Array.isArray(data.receivers)) {
        data.receivers.forEach((receiverId: string) => {
          if (receiverId !== userId) {
            socket.to(receiverId).emit("message", {
              type: 'NEW_MESSAGE',
              payload: data
            });
          }
        });
      }
    });

    // Ping for testing connection
    socket.on("ping", () => {
      console.log(`Ping from ${socket.id}`);
      socket.emit("pong", { timestamp: new Date().toISOString() });
    });

    socket.on("disconnect", (reason) => {
      console.log(`Client disconnected: ${socket.id}, User: ${userId || 'Guest'}, Reason: ${reason}`);
    });
  });

  return io;
};