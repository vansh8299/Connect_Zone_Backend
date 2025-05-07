// import { ApolloServer } from "@apollo/server";
// import { startStandaloneServer } from "@apollo/server/standalone";
// import { graphQLSchema } from "./schema/schema.js";
// import { graphQLResolver } from "./resolvers/resolvers.js";
// import { IncomingMessage, ServerResponse } from "http";

// interface ServerConfig {
//   port: number;
//   path: string;
//   env: string;
// }

// export type Context = {
//   req: IncomingMessage;
//   res: ServerResponse<IncomingMessage>;
//   // Add other context properties as needed
// };

// export const connectGraphQL = async (config: ServerConfig) => {
//   const server = new ApolloServer<Context>({
//     typeDefs: graphQLSchema,
//     resolvers: graphQLResolver,
//     introspection: config.env !== "PRODUCTION",
//     includeStacktraceInErrorResponses: config.env !== "PRODUCTION",
//   });

//   const { url } = await startStandaloneServer(server, {
//     listen: {
//       port: config.port,
//     },
//     context: async ({ req, res }) => ({
//       req,
//       res,
//       // Initialize other context values here
//     }),
//   });

//   console.log(`🚀 GraphQL Server ready at ${url}${config.path}`);
//   return {
//     server,
//     url: `${url}${config.path}`,
//   };
// };
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { graphQLSchema } from "./schema/schema.js";
import { graphQLResolver } from "./resolvers/resolvers.js";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cookie from "cookie";
import jwt from "jsonwebtoken"; // Add this import for token verification
import express from 'express';
import cors from 'cors';
import { expressMiddleware } from '@apollo/server/express4';

interface ServerConfig {
  port: number;
  path: string;
  env: string;
  corsOrigin?: string | string[];
}

export type Context = {
  req: any;
  res: any;
  token?: string;
  user?: any; // Add user context if you extract it from token
};

export const connectGraphQL = async (config: ServerConfig) => {
  // Support multiple origins or use a default
  const origins = Array.isArray(config.corsOrigin) 
    ? config.corsOrigin 
    : config.corsOrigin 
      ? [config.corsOrigin] 
      : ["http://localhost:3000"];
  
  // Create a standalone HTTP server for Socket.IO
  const httpServer = createServer();
  
  // Create Socket.IO server with configured origins
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: origins,
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    },
    // Ensure we support both polling and websockets
    transports: ['websocket', 'polling']
  });

  // Setup Apollo Server
  const server = new ApolloServer<Context>({
    typeDefs: graphQLSchema,
    resolvers: graphQLResolver,
    introspection: config.env !== "PRODUCTION",
    includeStacktraceInErrorResponses: config.env !== "PRODUCTION",
  });

  // Start the Apollo Server
  await server.start();
  
  // Create Express app for Apollo Server
  const app = express();
  
  // Configure CORS with proper origin settings
  app.use(
    cors({
      origin: origins,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );
  
  // Apply JSON middleware
  app.use(express.json());
  
  // Apply Apollo middleware
  app.use(
    expressMiddleware(server, {
      context: async ({ req, res }) => ({
        req,
        res,
        io, // Make io available in all resolvers
       
      }),
    }    )
  )
  
  // Start Express server
  const expressServer = app.listen(config.port);
  const url = `http://localhost:${config.port}/graphql`;

  // Socket.IO authentication middleware - with debug logging
  io.use((socket, next) => {
    console.log("Socket connection attempt");
    
    const cookies = cookie.parse(socket.request.headers.cookie || "");
    const token = cookies.token;
    
    // For debugging - log what we received
    console.log("Cookies received:", Object.keys(cookies).length > 0 ? 'Yes' : 'No');
    console.log("Token found:", token ? 'Yes' : 'No');
    
    // For development, you might want to allow connections without tokens
    if (!token && config.env !== "PRODUCTION") {
      console.log("No token, but allowing connection in development mode");
      socket.data.authenticated = false;
      return next();
    }
    
    if (!token) {
      console.log("No token provided, rejecting connection");
      return next(new Error("Authentication required"));
    }
    
    // Token verification - replace with your actual logic
    try {
      // Example: const user = jwt.verify(token, process.env.JWT_SECRET);
      // socket.data.user = user;
      
      // For now, just accept any token
      socket.data.authenticated = true;
      console.log("Socket authenticated successfully");
      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Invalid authentication"));
    }
  });

  // Socket.IO connection handler
  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}, Authenticated: ${socket.data.authenticated || false}`);
    
    // Add your socket event handlers here
    socket.on("message", (data) => {
      console.log(`Message from ${socket.id}:`, data);
      // Process message and broadcast as needed
      io.emit("message", { id: socket.id, ...data });
    });

    // Add a ping event for testing connection
    socket.on("ping", () => {
      console.log(`Ping from ${socket.id}`);
      socket.emit("pong", { timestamp: new Date().toISOString() });
    });

    socket.on("disconnect", (reason) => {
      console.log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
    });
  });

  // Start the Socket.IO server on a different port
  const socketPort = config.port + 1; // Use the next port for Socket.IO
  httpServer.listen(socketPort, () => {
    console.log(`🔌 Socket.IO Server running on port ${socketPort}`);
    console.log(`   - CORS origins: ${origins.join(', ')}`);
    console.log(`   - Environment: ${config.env}`);
  });

  console.log(`🚀 GraphQL Server ready at ${url}`);

  return {
    server,
    io,
    httpServer,
    url,
    socketPort,
  };
};