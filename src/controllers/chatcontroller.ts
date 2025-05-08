import { PrismaClient, User } from "../generated/prisma";
import { PubSub } from 'graphql-subscriptions';
import { CreateGroupInput, UpdateGroupInput } from "../graphql/types/chattypes";





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

// Group controllers

// src/resolvers/group.resolvers.ts


// Query Resolvers
export const getGroup = async (_: any, { groupId }: { groupId: string }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Verify user is a participant in the group
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId: groupId,
      userId,
      leftAt: null
    }
  });
  
  if (!participant) {
    throw new Error('Not authorized to view this group');
  }
  
  // Get group with conversation details
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      creator: true,
      conversation: {
        include: {
          participants: {
            include: {
              user: true
            }
          }
        }
      }
    }
  });
  
  if (!group) {
    throw new Error('Group not found');
  }
  
  return {
    ...group,
    participants: group?.conversation?.participants || []
  };
};

export const getUserGroups = async (_: any, __: any, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Find all groups the user is a participant in
  const participantGroups = await prisma.conversationParticipant.findMany({
    where: {
      userId,
      leftAt: null,
      conversation: {
        isGroup: true
      }
    },
    include: {
      conversation: {
        include: {
          group: {
            include: {
              creator: true
            }
          },
          participants: {
            include: {
              user: true
            }
          }
        }
      }
    }
  });
  
  // Extract and format group data
  return participantGroups.map(participant => {
    const group = participant.conversation.group;
    return {
      ...group,
      conversation: participant.conversation,
      participants: participant.conversation.participants
    };
  });
};

// Mutation Resolvers
export const createGroup = async (_: any, { input }: { input: CreateGroupInput }, context: any) => {
  const userId = getCurrentUserId(context);
  const { name, description, participantIds } = input;
  
  // Validate input
  if (!name || name.trim() === '') {
    throw new Error('Group name is required');
  }
  
  if (participantIds.length === 0) {
    throw new Error('At least one participant is required');
  }
  
  // Make sure all provided IDs are valid users
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: participantIds
      }
    }
  });
  
  if (users.length !== participantIds.length) {
    throw new Error('One or more participant IDs are invalid');
  }
  
  // Create transaction to ensure both conversation and group are created
  return prisma.$transaction(async (tx) => {
    // Create the conversation first
    const conversation = await tx.conversation.create({
      data: {
        isGroup: true,
        name,
        participants: {
          create: [
            { userId }, // Add creator
            ...participantIds.map(id => ({ userId: id })) // Add other participants
          ]
        }
      },
      include: {
        participants: {
          include: {
            user: true
          }
        }
      }
    });
    
    // Create the group using the conversation ID
    const group = await tx.group.create({
      data: {
        id: conversation.id, // Use same ID for both
        name,
        description,
        creatorId: userId
      },
      include: {
        creator: true
      }
    });
    
    return {
      ...group,
      conversation,
      participants: conversation.participants
    };
  });
};

export const updateGroup = async (_: any, { input }: { input: UpdateGroupInput }, context: any) => {
  const userId = getCurrentUserId(context);
  const { groupId, name, description, avatar } = input;
  
  // Verify user is the creator of the group
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  
  if (!group) {
    throw new Error('Group not found');
  }
  
  if (group.creatorId !== userId) {
    throw new Error('Only the group creator can update group details');
  }
  
  // Update both group and conversation name
  return prisma.$transaction(async (tx) => {
    // Update conversation if name changed
    if (name) {
      await tx.conversation.update({
        where: { id: groupId },
        data: { name }
      });
    }
    
    // Update group details
    const updatedGroup = await tx.group.update({
      where: { id: groupId },
      data: {
        name: name || undefined,
        description: description !== undefined ? description : undefined,
        avatar: avatar !== undefined ? avatar : undefined
      },
      include: {
        creator: true,
        conversation: {
          include: {
            participants: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });
    
    return {
      ...updatedGroup,
      participants: updatedGroup.conversation.participants
    };
  });
};

export const addGroupParticipants = async (_: any, { groupId, participantIds }: { groupId: string, participantIds: string[] }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Verify user is in the group
  const userParticipant = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId: groupId,
      userId,
      leftAt: null
    }
  });
  
  if (!userParticipant) {
    throw new Error('Not authorized to add participants to this group');
  }
  
  // Make sure all provided IDs are valid users
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: participantIds
      }
    }
  });
  
  if (users.length !== participantIds.length) {
    throw new Error('One or more participant IDs are invalid');
  }
  
  // Check if any users are already participants
  const existingParticipants = await prisma.conversationParticipant.findMany({
    where: {
      conversationId: groupId,
      userId: {
        in: participantIds
      },
      leftAt: null
    }
  });
  
  const newParticipantIds = participantIds.filter(
    id => !existingParticipants.some(p => p.userId === id)
  );
  
  // Add new participants
  await prisma.conversationParticipant.createMany({
    data: newParticipantIds.map(id => ({
      conversationId: groupId,
      userId: id
    }))
  });
  
  // Get updated group
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      creator: true,
      conversation: {
        include: {
          participants: {
            include: {
              user: true
            }
          }
        }
      }
    }
  });
  
  return {
    ...group,
    participants: group?.conversation?.participants || [] 
  };
};

export const removeGroupParticipant = async (_: any, { groupId, participantId }: { groupId: string, participantId: string }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Check if user is the creator
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  
  if (!group) {
    throw new Error('Group not found');
  }
  
  // Only creator can remove others, or user can remove themselves
  if (group.creatorId !== userId && participantId !== userId) {
    throw new Error('Not authorized to remove this participant');
  }
  
  // Check if participant exists
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId: groupId,
      userId: participantId,
      leftAt: null
    }
  });
  
  if (!participant) {
    throw new Error('Participant not found in this group');
  }
  
  // Don't allow removing the creator
  if (participantId === group.creatorId) {
    throw new Error('Cannot remove the group creator');
  }
  
  // Mark participant as left
  await prisma.conversationParticipant.update({
    where: { id: participant.id },
    data: { leftAt: new Date() }
  });
  
  // Get updated group
  const updatedGroup = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      creator: true,
      conversation: {
        include: {
          participants: {
            where: {
              leftAt: null
            },
            include: {
              user: true
            }
          }
        }
      }
    }
  });
  
  return {
    ...updatedGroup,
    participants: updatedGroup?.conversation?.participants || []
  };
};

export const leaveGroup = async (_: any, { groupId }: { groupId: string }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Find user's participant record
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId: groupId,
      userId,
      leftAt: null
    }
  });
  
  if (!participant) {
    throw new Error('You are not a member of this group');
  }
  
  // Check if user is the creator
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  
  if (!group) {
    throw new Error('Group not found');
  }
  
  if (group.creatorId === userId) {
    throw new Error('Group creator cannot leave. Transfer ownership or delete the group instead.');
  }
  
  // Mark as left
  await prisma.conversationParticipant.update({
    where: { id: participant.id },
    data: { leftAt: new Date() }
  });
  
  return true;
};

export const deleteGroup = async (_: any, { groupId }: { groupId: string }, context: any) => {
  const userId = getCurrentUserId(context);
  
  // Verify user is the creator
  const group = await prisma.group.findUnique({
    where: { id: groupId }
  });
  
  if (!group) {
    throw new Error('Group not found');
  }
  
  if (group.creatorId !== userId) {
    throw new Error('Only the group creator can delete the group');
  }
  
  // Delete group and conversation
  await prisma.$transaction([
    prisma.group.delete({
      where: { id: groupId }
    }),
    prisma.conversation.delete({
      where: { id: groupId }
    })
  ]);
  
  return true;
};

// Types for TypeScript
