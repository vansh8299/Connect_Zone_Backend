import { PrismaClient, User } from "../generated/prisma";
import { PubSub } from 'graphql-subscriptions';


const prisma = new PrismaClient();
const pubsub = new PubSub();
const parseCookies = (cookieString: string) => {
  return cookieString.split(';').reduce((acc: Record<string, string>, cookie) => {
    const [name, value] = cookie.trim().split('=');
    acc[name] = decodeURIComponent(value);
    return acc;
  }, {});
};
const extractUserIdFromToken = (token: string): string => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
    return payload.userId;
  } catch (error) {
    console.error('Error extracting user ID from token:', error);
    throw new Error('Invalid token');
  }
};

const getCurrentUserId = (context: any): string => {
  const cookies = context.req.headers.cookie;
  if (!cookies) throw new Error('Unauthorized - No cookies found');
  
  const parsedCookies = parseCookies(cookies);
  const token = parsedCookies.token;
  
  if (!token) throw new Error('Unauthorized - No token found');
  
  return extractUserIdFromToken(token);
};

export const getConversations = async (_: any, __: any, context: any) => {
  const userId = getCurrentUserId(context);
    
  return await prisma.conversation.findMany({
    where: {
      participants: {
        some: {
          userId: userId
        }
      }
    },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          }
        }
      },
      messages: {
        take: 1,
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  });
};

export const getMessages = async (_: any, { conversationId }: { conversationId: string }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Verify user is part of conversation
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      userId: userId,
      conversationId
    }
  });
  
  if (!participant) throw new Error('Unauthorized');
  
  return await prisma.message.findMany({
    where: {
      conversationId
    },
    orderBy: {
      createdAt: 'asc'
    },
    include: {
      sender: true,
      readBy: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          }
        }
      }
    }
  });
};

export const createConversation = async (_: any, { participantIds }: { participantIds: string[] }, context: any) => {
  const userId = getCurrentUserId(context);
  
  console.log('Creating conversation for userId:', userId, 'with participants:', participantIds);
  
  // Ensure we're not creating a conversation with ourselves
  if (participantIds.length === 1 && participantIds[0] === userId) {
    throw new Error('Cannot create conversation with yourself');  
  }
  
  // Check if conversation already exists between these users (for 1:1 chats)
  if (participantIds.length === 1) {
    // Create an array of both user IDs, ensuring neither is undefined
    const userIdsToCheck = [userId, participantIds[0]].filter(id => id !== undefined);
    
    // First approach: Find conversations where both users are participants
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { isGroup: false },
          {
            participants: {
              some: {
                userId: userId
              }
            }
          },
          {
            participants: {
              some: {
                userId: participantIds[0]
              }
            }
          },
          {
            participants: {
              every: {
                userId: {
                  in: userIdsToCheck
                }
              }
            }
          }
        ]
      },
      include: {
        participants: {
          include: {
            user: true
          }
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    
    if (existingConversation) {
      return existingConversation;
    }
  }
  
  // Create new conversation if one doesn't exist
  const conversation = await prisma.conversation.create({
    data: {
      isGroup: participantIds.length > 1,
      participants: {
        create: [
          { userId },
          ...participantIds.map(id => ({ userId: id }))
        ]
      }
    },
    include: {
      participants: {
        include: {
          user: true
        }
      },
      messages: {
        take: 1,
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  });
  
  return conversation;
};

export const sendMessage = async (_: any, { input }: { input: { conversationId: string, content: string } }, context: any) => {
  const userId = getCurrentUserId(context);

  // Verify user is part of conversation
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      userId: userId,
      conversationId: input.conversationId
    }
  });
  
  if (!participant) throw new Error('Unauthorized');
  
  // Make sure conversationId and content are defined
  if (!input.conversationId) throw new Error('Conversation ID is required');
  if (!input.content) throw new Error('Message content is required');
  
  // Create the new message
  const message = await prisma.message.create({
    data: {
      content: input.content,
      senderId: userId,
      conversationId: input.conversationId,
      type: 'TEXT',
    },
    include: {
      sender: true,
      conversation: {
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true
                }
              }
            }
          }
        }
      }
    }
  });

  // Mark as read by sender
  await prisma.messageRead.create({
    data: {
      messageId: message.id,
      userId: userId
    }
  });

  // Get the complete message with readBy info
  const completeMessage = await prisma.message.findUnique({
    where: { id: message.id },
    include: {
      sender: true,
      readBy: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          }
        }
      }
    }
  });

  if (!completeMessage) {
    throw new Error('Failed to create message');
  }

  // Extract participant IDs for direct notifications
  const participantIds = message.conversation.participants
    .map(participant => participant.user.id)
    .filter(id => id !== userId); // exclude sender

  // Use Socket.IO to emit the message to all participants
  if (context.io) {
    try {
      // First, emit to the conversation room
      context.io.to(input.conversationId).emit('message', {
        type: 'NEW_MESSAGE',
        payload: completeMessage
      });
      console.log(`Emitted message to conversation room: ${input.conversationId}`);
      
      // Then, also emit to each participant's personal room to ensure delivery
      participantIds.forEach(participantId => {
        context.io.to(participantId).emit('message', {
          type: 'NEW_MESSAGE',
          payload: completeMessage
        });
        console.log(`Emitted message to user room: ${participantId}`);
      });
    } catch (error) {
      console.error('Error emitting socket message:', error);
      // Don't fail the mutation if socket emission fails
    }
  } else {
    console.warn('Socket.IO instance not available in context');
  }

  return completeMessage;
};
  export const markAsRead = async (_: any, { messageId }: { messageId: string }, context: any) => {
    if (!context.userId) throw new Error('Unauthorized');
    
    // Check if message exists and user is part of conversation
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: true
          }
        }
      }
    });
    
    if (!message) throw new Error('Message not found');
    
    const isParticipant = message.conversation.participants.some(
      p => p.userId === context.userId
    );
    
    if (!isParticipant) throw new Error('Unauthorized');
    
    // Check if already read
    const existingRead = await prisma.messageRead.findFirst({
      where: {
        messageId,
        userId: context.userId
      }
    });
    
    if (existingRead) return message;
    
    await prisma.messageRead.create({
      data: {
        messageId,
        userId: context.userId
      }
    });
    
    return message;
  }

  export const getUserByEmail = async (
    _: unknown,
    { email }: { email: string }
  ): Promise<User> => {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });
  
      if (!user) {
        throw new Error(`User with email ${email} not found`);
      }
  
      return { ...user, password: user.password || "" };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch user by email: ${error.message}`);
      }
      throw new Error("Failed to fetch user by email due to an unknown error");
    }
  };
  
  export const searchUsers = async (
    _: unknown,
    { searchTerm }: { searchTerm: string }
  ): Promise<User[]> => {
    try {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { firstName: { contains: searchTerm, mode: 'insensitive' } },
            { lastName: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 10, // Limit results to 10 users
      });
  
      return users.map(user => ({ ...user, password: user.password || "" }));
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to search users: ${error.message}`);
      }
      throw new Error("Failed to search users due to an unknown error");
    }
  };
// export const Subscription = {
//   messageSent: {
//     subscribe: (_: any, { conversationId }: { conversationId: string }, context: any) => {
//       if (!context.userId) throw new Error('Unauthorized');
      
//       // Verify user is part of conversation
//       return (pubsub as any).asyncIterator(`MESSAGE_SENT_${conversationId}`);
//     }
//   },
  
//   newMessage: {
//     subscribe: (_: any, __: any, context: any) => {
//       if (!context.userId) throw new Error('Unauthorized');
//       return (pubsub as any).asyncIterator([`NEW_MESSAGE_${context.userId}`]);
//     }
//   }
// };

