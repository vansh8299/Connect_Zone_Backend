import dotenv from 'dotenv';
import { connectGraphQL } from './graphql/graphql';


dotenv.config({ path: './.env' });

export const envMode = process.env.NODE_ENV?.trim() || 'DEVELOPMENT';
const port = parseInt(process.env.PORT || '4000');
const uri = process.env.GRAPHQL_URI || 'graphql';

const startServer = async () => {
  try {
    await connectGraphQL({
      port,
      path: uri,
      env: envMode
    });
    console.log(`Server running in ${envMode} mode on port ${port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();