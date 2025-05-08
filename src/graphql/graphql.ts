import { ApolloServer } from "@apollo/server";
import { graphQLSchema } from "./schema/schema.js";
import { graphQLResolver } from "./resolvers/resolvers.js";
import express from 'express';
import cors from 'cors';
import { expressMiddleware } from '@apollo/server/express4';

interface ServerConfig {
  port: number;
  path: string;
  env: string;
  corsOrigin?: string | string[];
  httpServer?: any; // Accept the HTTP server from the main file
  io?: any; // Accept the Socket.IO instance from the main file
}

export type Context = {
  req: any;
  res: any;
  token?: string;
  user?: any;
  io?: any; // Make io available in context
};

export const connectGraphQL = async (config: ServerConfig) => {
  // Support multiple origins or use a default
  const origins = Array.isArray(config.corsOrigin) 
    ? config.corsOrigin 
    : config.corsOrigin 
      ? [config.corsOrigin] 
      : [process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000"];
  
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
    `/${config.path}`,
    expressMiddleware(server, {
      context: async ({ req, res }) => ({
        req,
        res,
        io: config.io, // Make io available in all resolvers
      }),
    })
  );
  
  // If HTTP server was provided, use it
  if (config.httpServer) {
    config.httpServer.on('request', app);
    
    console.log(`🚀 GraphQL Server mounted on existing HTTP server at /${config.path}`);
    return {
      server,
      io: config.io,
      httpServer: config.httpServer,
      url: `http://localhost:${config.port}/${config.path}`,
    };
  } else {
    // Otherwise, create a new server (fallback for backward compatibility)
    console.log("⚠️ No HTTP server provided, creating a standalone GraphQL server");
    const expressServer = app.listen(config.port);
    
    console.log(`🚀 GraphQL Server ready at http://localhost:${config.port}/${config.path}`);
    return {
      server,
      expressServer,
      url: `http://localhost:${config.port}/${config.path}`,
    };
  }
};