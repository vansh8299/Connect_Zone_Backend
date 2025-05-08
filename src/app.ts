import dotenv from 'dotenv';
import { createServer } from 'http';
import { Socket, Server as SocketServer } from 'socket.io';
import { connectGraphQL } from './graphql/graphql';
import cookie from 'cookie';

dotenv.config({ path: './.env' });

export const envMode = process.env.NODE_ENV?.trim() || 'DEVELOPMENT';
const port = parseInt(process.env.PORT || '4000');
const uri = process.env.GRAPHQL_URI || 'graphql';

// Global socket.io instance - will be initialized in startServer()
export let io: SocketServer | undefined;

const startServer = async () => {
  try {
    // Create a single HTTP server
    const httpServer = createServer();
    
    // Initialize Socket.IO with this server
    io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"]
      },
      transports: ['websocket', 'polling']
    });
    
    // Socket.IO authentication middleware
    io.use(async (socket: Socket, next: Function) => {
      console.log("Socket connection attempt");
      
      // Extract token from headers or cookies
      const authHeader = socket.handshake.auth.token;
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const token = authHeader || cookies.token;
      
      console.log("Token found:", token ? 'Yes' : 'No');
      
      // For development, allow connections without tokens
      if (!token && envMode !== "PRODUCTION") {
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
    io.on('connection', (socket: Socket) => {
      console.log('New client connected:', socket.id);
      
      const userId = socket.data.userId;
      if (userId) {
        // Join user to their personal room
        socket.join(userId);
        console.log(`User ${userId} joined personal room`);
        
        // Handle joining conversation rooms
        socket.on('joinConversation', (conversationId: any) => {
          if (!conversationId) return;
          
          socket.join(conversationId);
          console.log(`User ${userId} joined conversation ${conversationId}`);
          
          // Notify the room that a user joined (optional)
          socket.to(conversationId).emit("userJoined", {
            userId: userId,
            timestamp: new Date().toISOString()
          });
        });
        
        // Handle leaving conversation rooms
        socket.on('leaveConversation', (conversationId: any) => {
          if (!conversationId) return;
          
          socket.leave(conversationId);
          console.log(`User ${userId} left conversation ${conversationId}`);
        });
        
        // Handle message sending
        socket.on("message", (data: { conversationId: any; receivers: any[]; }) => {
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
            data.receivers.forEach((receiverId: any) => {
              if (receiverId !== userId) {
                socket.to(receiverId).emit("message", {
                  type: 'NEW_MESSAGE',
                  payload: data
                });
              }
            });
          }
        });
      }
      
      // Ping for testing connection
      socket.on("ping", () => {
        console.log(`Ping from ${socket.id}`);
        socket.emit("pong", { timestamp: new Date().toISOString() });
      });
      
      socket.on('disconnect', (reason: any) => {
        console.log(`Client disconnected: ${socket.id}, User: ${userId || 'Guest'}, Reason: ${reason}`);
      });
    });

    // Connect GraphQL using our HTTP server and providing the io instance
    await connectGraphQL({
      port,
      path: uri,
      env: envMode,
      httpServer, // Pass the existing HTTP server
      io // Pass the Socket.IO instance
    });
    
    // Start the HTTP server
    httpServer.listen(port, () => {
      console.log(`🚀 Server ready at http://localhost:${port}/${uri}`);
      console.log(`🔌 Socket.IO running on the same port`);
      console.log(`   - Environment: ${envMode}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();