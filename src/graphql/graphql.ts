import { ApolloServer } from "@apollo/server";
import { graphQLSchema } from "./schema/schema.js";
import { graphQLResolver } from "./resolvers/resolvers.js";
import express from "express";
import cors from "cors";
import { expressMiddleware } from "@apollo/server/express4";

interface ServerConfig {
  port: number;
  path: string;
  env: string;
  corsOrigin?: string | string[];
  httpServer?: any; // Accept the HTTP server from the main file
  io?: any; // Accept the Socket.IO instance from the main file
}

import { BaseContext } from "@apollo/server";

export interface Context extends BaseContext {
  req: any;
  res: any;
  token?: string;
  user?: any;
  io?: any; // Make io available in context
}

export const connectGraphQL = async (config: ServerConfig) => {
  // Support multiple origins or use a default
  const origins = Array.isArray(config.corsOrigin)
    ? config.corsOrigin
    : config.corsOrigin
    ? [config.corsOrigin]
    : [
        process.env.NEXT_PUBLIC_CLIENT_URL || "http://localhost:3000",
        "http://localhost:3001",
      ];

  // Setup Apollo Server with enhanced configuration
  const server = new ApolloServer<Context>({
    typeDefs: graphQLSchema,
    resolvers: graphQLResolver,
    introspection: config.env !== "PRODUCTION",
    includeStacktraceInErrorResponses: config.env !== "PRODUCTION",
    // Increase payload limits for WebRTC SDP data
    formatError: (err) => {
      console.error("GraphQL Error:", err);
      return {
        message: err.message,
        code: err.extensions?.code,
        path: err.path,
      };
    },
    plugins: [
      {
        // Proper error handling plugin
        requestDidStart: async () => ({
          willSendResponse: async ({ response }) => {
            // Handle errors properly
            if (
              response.body.kind === "single" &&
              response.body.singleResult.errors
            ) {
              console.error(
                "GraphQL Errors:",
                response.body.singleResult.errors
              );
            }
          },
        }),
      },
    ],
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
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Increase payload limits for WebRTC SDP data
  app.use(
    express.json({
      limit: "10mb", // Increase from default 100kb to handle large SDP payloads
    })
  );

  app.use(
    express.urlencoded({
      limit: "50mb",
      extended: true,
    })
  );

  // Apply Apollo middleware with proper error handling
  app.use(
    `/${config.path}`,
    expressMiddleware(server, {
      context: async ({ req, res }) => {
        // Extract token from header or cookie
        const token =
          req.headers.authorization || (req.cookies && req.cookies.token);

        // Return context with type safety
        const ctx: Context = {
          req,
          res,
          token,
          io: config.io,
        };

        return ctx;
      },
    })
  );

  // Add error handling middleware after Apollo
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      console.error("Express Error:", err);

      // Handle payload too large errors specifically
      if (err.type === "entity.too.large") {
        return res.status(413).json({
          error: "Request payload too large",
          success: false,
        });
      }

      // Don't expose internal errors in production
      if (config.env === "PRODUCTION") {
        res.status(500).json({
          error: "Internal server error",
          success: false,
        });
      } else {
        res.status(err.status || 500).json({
          error: err.message,
          success: false,
          stack: err.stack,
        });
      }
    }
  );

  // Add health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() });
  });

  // If HTTP server was provided, use it
  if (config.httpServer) {
    config.httpServer.on("request", app);

    console.log(
      `🚀 GraphQL Server mounted on existing HTTP server at /${config.path}`
    );
    console.log(`📊 Health check available at /health`);
    console.log(`📦 Payload limit: 10mb for WebRTC SDP data`);

    return {
      server,
      io: config.io,
      httpServer: config.httpServer,
      url: `http://localhost:${config.port}/${config.path}`,
    };
  } else {
    // Otherwise, create a new server (fallback for backward compatibility)
    console.log(
      "⚠️ No HTTP server provided, creating a standalone GraphQL server"
    );
    const expressServer = app.listen(config.port);

    console.log(
      `🚀 GraphQL Server ready at http://localhost:${config.port}/${config.path}`
    );
    console.log(
      `📊 Health check available at http://localhost:${config.port}/health`
    );
    console.log(`📦 Payload limit: 10mb for WebRTC SDP data`);

    return {
      server,
      expressServer,
      url: `http://localhost:${config.port}/${config.path}`,
    };
  }
};
