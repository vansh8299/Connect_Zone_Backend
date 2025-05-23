import { addGroupParticipants, createConversation, createGroup, deleteGroup, getConversations, getGroup, getMessages, getUserByEmail, getUserGroups, leaveGroup, markAsRead, removeGroupParticipant, searchUsers, sendMessage, updateGroup } from "../../controllers/chatcontroller";
import {
  getAllUsers,
  getUserById,
  googleAuth,
  login,
  sendOtp,
  signup,
  updatePassword,
  updateUser,
  verifyOtp,
} from "../../controllers/graphql";
import { PubSub } from 'graphql-subscriptions';

const pubsub = new PubSub();

export const graphQLResolver = {
  Query: {
    users: getAllUsers,
    user: getUserById,
    getConversations: getConversations,
    getMessages: getMessages,
    userByEmail: getUserByEmail,
    searchUsers: searchUsers,
    getGroup,
    getUserGroups
    

  },
  Mutation: {
    signup,
    login,
    sendOtp,
    verifyOtp,
    googleAuth,
    updateUser,
    updatePassword,
    createConversation: createConversation,
    sendMessage: sendMessage,
    markAsRead: markAsRead,
    createGroup,
    updateGroup,
addGroupParticipants,
removeGroupParticipant,
leaveGroup,
deleteGroup
  },
  Subscription: {
    messageSent: {
      subscribe: (_: any, { conversationId }: { conversationId: string }, context: any) => {
        if (!context.userId) throw new Error('Unauthorized');
        
        // Verify user is part of conversation
        return (pubsub as any).asyncIterator(`MESSAGE_SENT_${conversationId}`);
      }
    },
    newMessage: {
      subscribe: (_: any, __: any, context: any) => {
        if (!context.userId) throw new Error('Unauthorized');
        return (pubsub as any).asyncIterator([`NEW_MESSAGE_${context.userId}`]);
      }
    }
  }
};
