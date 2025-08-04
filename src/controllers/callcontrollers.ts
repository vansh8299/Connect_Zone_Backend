// callcontrollers.ts - Enhanced with better error handling and logging

import { PrismaClient, CallStatus } from "../generated/prisma";
import { PubSub } from 'graphql-subscriptions';
import { Context } from "../graphql/types/types";
import { GraphQLError } from "graphql";

const prisma = new PrismaClient();
const pubsub = new PubSub() as any;

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
    console.log('Decoded token payload:', payload);
    return payload.userId;
  } catch (error) {
    console.error('Error extracting user ID from token:', error);
    throw new Error('Invalid token');
  }
};

const getCurrentUserId = (context: any): string => {
  // Handle different context structures
  let cookies: string | undefined;
  
  // Try different ways to access cookies based on Apollo Server version and setup
  if (context.req?.headers?.cookie) {
    cookies = context.req.headers.cookie;
  } else if (context.request?.headers?.cookie) {
    cookies = context.request.headers.cookie;
  } else if (context.headers?.cookie) {
    cookies = context.headers.cookie;
  } else if (context.connectionParams?.cookie) {
    cookies = context.connectionParams.cookie;
  }
  
  if (!cookies) {
    console.error('No cookies found in context. Context structure:', {
      hasReq: !!context.req,
      hasRequest: !!context.request,
      hasHeaders: !!context.headers,
      hasConnectionParams: !!context.connectionParams,
      contextKeys: Object.keys(context)
    });
    throw new Error('Unauthorized - No cookies found');
  }
  
  const parsedCookies = parseCookies(cookies);
  const token = parsedCookies.token;
  
  if (!token) throw new Error('Unauthorized - No token found');
  
  return extractUserIdFromToken(token);
};

export const getCurrentUser = async (_: any, __: any, context: any) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Current user ID from context:', currentuserId);
    
    const user = await prisma.user.findUnique({
      where: { id: currentuserId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        isEmailVerified: true,
        about: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    
    console.log('Fetched user:', user);
    
    if (!user) {
      throw new GraphQLError("User not found", {
        extensions: {
          code: "NOT_FOUND",
          http: { status: 404 },
        },
      });
    }

    return user;
  } catch (error) {
    console.error("Error fetching current user:", error);
    
    if (error instanceof GraphQLError) {
      throw error;
    }
    
    throw new GraphQLError("Failed to fetch user", {
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        http: { status: 500 },
      },
    });
  }
};

export const getCall = async (_: any, { id }: { id: string }, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Getting call:', id, 'for user:', currentuserId);
    
    const call = await prisma.call.findUnique({
      where: { id },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    if (!call) {
      console.log('Call not found:', id);
      throw new Error('Call not found');
    }
    
    // Check if user is part of this call
    if (call.callerId !== currentuserId && call.receiverId !== currentuserId) {
      console.log('User not authorized for call:', currentuserId, 'Call participants:', call.callerId, call.receiverId);
      throw new Error('You are not authorized to view this call');
    }
    
    console.log('Call found:', call);
    return call;
  } catch (error) {
    console.error('Error fetching call:', error);
    throw new Error('Failed to fetch call');
  }
};

export const getCallHistory = async (_: any, __: any, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    
    const calls = await prisma.call.findMany({
      where: {
        OR: [
          { callerId: currentuserId },
          { receiverId: currentuserId }
        ]
      },
      orderBy: {
        startedAt: 'desc'
      },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    return calls;
  } catch (error) {
    console.error('Error fetching call history:', error);
    throw new Error('Failed to fetch call history');
  }
};

export const startCall = async (_: any, { input }: { input: { receiverId: string } }, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Starting call from:', currentuserId, 'to:', input.receiverId);
    
    // Validate that caller and receiver are different
    if (currentuserId === input.receiverId) {
      throw new Error('Cannot call yourself');
    }
    
    // Check if receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: input.receiverId }
    });
 
    if (!receiver) {
      console.log('Receiver not found:', input.receiverId);
      throw new Error('Receiver not found');
    }
    
    // Check if there's already an ongoing call between these users
    const existingCall = await prisma.call.findFirst({
      where: {
        OR: [
          {
            callerId: currentuserId,
            receiverId: input.receiverId,
            status: { in: ['INITIATED', 'ONGOING'] }
          },
          {
            callerId: input.receiverId,
            receiverId: currentuserId,
            status: { in: ['INITIATED', 'ONGOING'] }
          }
        ]
      }
    });
    
    if (existingCall) {
      console.log('Call already exists:', existingCall.id);
      return {
        call: existingCall,
        sdpOffer: null,
        iceCandidate: null
      };
    }
    
    // Create call record
    const call = await prisma.call.create({
      data: {
        callerId: currentuserId,
        receiverId: input.receiverId,
        status: 'INITIATED',
        startedAt: new Date()
      },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    console.log('Call created successfully:', call);
    
    // Publish to subscription
    try {
      await pubsub.publish('callInitiated', { 
        callInitiated: {
          call,
          sdpOffer: null,
          iceCandidate: null
        }
      });
      console.log('Published callInitiated event');
    } catch (pubsubError) {
      console.error('Error publishing callInitiated:', pubsubError);
      // Don't throw here as the call was created successfully
    }
    
    return {
      call,
      sdpOffer: null,
      iceCandidate: null
    };
  } catch (error) {
    console.error('Error starting call:', error);
  }
};

export const answerCall = async (_: any, { input }: { input: { callId: string, sdpAnswer: string } }, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Answering call:', input.callId, 'by user:', currentuserId);
    
    // Get the call
    const call = await prisma.call.findUnique({
      where: { id: input.callId },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    if (!call) {
      throw new Error('Call not found');
    }
    
    if (call.receiverId !== currentuserId) {
      throw new Error('You are not the receiver of this call');
    }
    
    if (call.status !== 'INITIATED') {
      throw new Error('Call is not in the initiated state');
    }
    
    // Update call status
    const updatedCall = await prisma.call.update({
      where: { id: input.callId },
      data: {
        status: 'ONGOING'
      },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    console.log('Call answered successfully:', updatedCall);
    
    // Publish to subscription
    try {
      await pubsub.publish(`callAnswered_${input.callId}`, { 
        callAnswered: {
          call: updatedCall,
          sdpOffer: null,
          iceCandidate: null
        }
      });
      console.log('Published callAnswered event for call:', input.callId);
    } catch (pubsubError) {
      console.error('Error publishing callAnswered:', pubsubError);
    }
    
    return {
      call: updatedCall,
      sdpAnswer: input.sdpAnswer,
      iceCandidate: null
    };
  } catch (error) {
    console.error('Error answering call:', error);
  }
};

export const endCall = async (_: any, { input }: { input: { callId: string } }, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Ending call:', input.callId, 'by user:', currentuserId);
    
    // Get the call
    const call = await prisma.call.findUnique({
      where: { id: input.callId },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    if (!call) {
      throw new Error('Call not found');
    }
    
    if (call.callerId !== currentuserId && call.receiverId !== currentuserId) {
      throw new Error('You are not part of this call');
    }
    
    // Calculate duration if call was ongoing
    let duration = null;
    if (call.status === 'ONGOING') {
      const now = new Date();
      duration = Math.floor((now.getTime() - call.startedAt.getTime()) / 1000);
    }
    
    // Determine final status
    let finalStatus: CallStatus = 'COMPLETED';
    if (call.status === 'INITIATED') {
      finalStatus = call.receiverId === currentuserId ? 'REJECTED' : 'MISSED';
    }
    
    // Update call
    const endedCall = await prisma.call.update({
      where: { id: input.callId },
      data: {
        status: finalStatus,
        endedAt: new Date(),
        duration
      },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    console.log('Call ended successfully:', endedCall);
    
    // Publish to subscription
    try {
      await pubsub.publish(`callEnded_${input.callId}`, { callEnded: endedCall });
      console.log('Published callEnded event for call:', input.callId);
    } catch (pubsubError) {
      console.error('Error publishing callEnded:', pubsubError);
    }
    
    return endedCall;
  } catch (error) {
    console.error('Error ending call:', error);
  }
};

export const addIceCandidate = async (_: any, { input }: { input: { callId: string, candidate: string } }, context: Context) => {
  try {
    const currentuserId = getCurrentUserId(context);
    console.log('Adding ICE candidate for call:', input.callId, 'by user:', currentuserId);
    
    // Get the call
    const call = await prisma.call.findUnique({
      where: { id: input.callId }
    });
    
    if (!call) {
      throw new Error('Call not found');
    }
    
    if (call.callerId !== currentuserId && call.receiverId !== currentuserId) {
      throw new Error('You are not part of this call');
    }
    
    // Publish ICE candidate to the other participant
    try {
      await pubsub.publish(`iceCandidateReceived_${input.callId}`, { 
        iceCandidateReceived: {
          callId: input.callId,
          candidate: input.candidate
        }
      });
      console.log('Published ICE candidate for call:', input.callId);
    } catch (pubsubError) {
      console.error('Error publishing ICE candidate:', pubsubError);
    }
    
    return true;
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
};

export const callSubscriptions = {
  callInitiated: {
    subscribe: (_: any, __: any, context: Context) => {
      const currentuserId = getCurrentUserId(context);
      console.log('User subscribed to callInitiated:', currentuserId);
      return pubsub.asyncIterator(['callInitiated']);
    },
    resolve: (payload: any, _: any, context: Context) => {
      try {
        // Only notify the intended receiver
        const currentuserId = getCurrentUserId(context);
        if (payload.callInitiated?.call?.receiverId === currentuserId) {
          console.log('Sending callInitiated to receiver:', currentuserId);
          return payload.callInitiated;
        }
        return null;
      } catch (error) {
        console.error('Error in callInitiated resolver:', error);
        return null;
      }
    }
  },
  callAnswered: {
    subscribe: (_: any, { callId }: { callId: string }, context: Context) => {
      const currentuserId = getCurrentUserId(context);
      console.log('User subscribed to callAnswered for call:', callId, 'user:', currentuserId);
      return pubsub.asyncIterator([`callAnswered_${callId}`]);
    },
    resolve: (payload: any, args: { callId: string }, context: Context) => {
      try {
        // Only notify participants of this specific call
        const currentuserId = getCurrentUserId(context);
        if (payload.callAnswered?.call?.id === args.callId && 
            (payload.callAnswered?.call?.callerId === currentuserId || 
             payload.callAnswered?.call?.receiverId === currentuserId)) {
          console.log('Sending callAnswered to user:', currentuserId);
          return payload.callAnswered;
        }
        return null;
      } catch (error) {
        console.error('Error in callAnswered resolver:', error);
        return null;
      }
    }
  },
  callEnded: {
    subscribe: (_: any, { callId }: { callId: string }, context: Context) => {
      const currentuserId = getCurrentUserId(context);
      console.log('User subscribed to callEnded for call:', callId, 'user:', currentuserId);
      return pubsub.asyncIterator([`callEnded_${callId}`]);
    },
    resolve: (payload: any, args: { callId: string }, context: Context) => {
      try {
        // Notify both participants of this specific call
        const currentuserId = getCurrentUserId(context);
        if (payload.callEnded?.id === args.callId && 
            (payload.callEnded?.callerId === currentuserId || 
             payload.callEnded?.receiverId === currentuserId)) {
          console.log('Sending callEnded to user:', currentuserId);
          return payload.callEnded;
        }
        return null;
      } catch (error) {
        console.error('Error in callEnded resolver:', error);
        return null;
      }
    }
  },
  iceCandidateReceived: {
    subscribe: (_: any, { callId }: { callId: string }, context: Context) => {
      const currentuserId = getCurrentUserId(context);
      console.log('User subscribed to iceCandidateReceived for call:', callId, 'user:', currentuserId);
      return pubsub.asyncIterator([`iceCandidateReceived_${callId}`]);
    },
    resolve: async (payload: any, args: { callId: string }, context: Context) => {
      try {
        // Check if payload exists and matches the call
        if (!payload || !payload.iceCandidateReceived || 
            payload.iceCandidateReceived.callId !== args.callId) {
          return null;
        }
        
        // Get the call to check participants
        const call = await prisma.call.findUnique({
          where: { id: args.callId }
        });
        
        if (!call) return null;
        
        // Only notify the other participant (not the sender)
        const currentuserId = getCurrentUserId(context);
        if (call.callerId === currentuserId || call.receiverId === currentuserId) {
          console.log('Sending ICE candidate to user:', currentuserId);
          return payload.iceCandidateReceived;
        }
        return null;
      } catch (error) {
        console.error('Error in iceCandidateReceived resolver:', error);
        return null;
      }
    }
  }
};