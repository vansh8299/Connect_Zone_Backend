import { PrismaClient, CallStatus } from "../generated/prisma";
import { PubSub } from 'graphql-subscriptions';
import { Context } from "../graphql/types/types";
import { GraphQLError } from "graphql";

const prisma = new PrismaClient();
const pubsub = new PubSub();

export const getCallHistory = async (_: any, __: any, context: Context) => {
  if (!context.userId) throw new Error('Unauthorized');
  
  try {
    const calls = await prisma.call.findMany({
      where: {
        OR: [
          { callerId: context.userId },
          { receiverId: context.userId }
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
  if (!context.userId) throw new Error('Unauthorized');
  
  try {
    // Check if receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: input.receiverId }
    });
    
    if (!receiver) {
      throw new Error('Receiver not found');
    }
    
    // Create call record
    const call = await prisma.call.create({
      data: {
        callerId: context.userId,
        receiverId: input.receiverId,
        status: 'INITIATED'
      },
      include: {
        caller: true,
        receiver: true
      }
    });
    
    // Publish to subscription
    await pubsub.publish('callInitiated', { 
      callInitiated: {
        call,
        sdpOffer: null,
        iceCandidate: null
      }
    });
    
    return {
      call,
      sdpOffer: null,
      iceCandidate: null
    };
  } catch (error) {
    console.error('Error starting call:', error);
    throw new Error('Failed to start call');
  }
};

export const answerCall = async (_: any, { input }: { input: { callId: string, sdpAnswer: string } }, context: Context) => {
  if (!context.userId) throw new Error('Unauthorized');
  
  try {
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
    
    if (call.receiverId !== context.userId) {
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
    
    // Publish to subscription
    await pubsub.publish('callAnswered', { 
      callAnswered: {
        call: updatedCall,
        sdpOffer: null,
        iceCandidate: null
      }
    });
    
    return {
      call: updatedCall,
      sdpAnswer: input.sdpAnswer,
      iceCandidate: null
    };
  } catch (error) {
    console.error('Error answering call:', error);
    throw new Error('Failed to answer call');
  }
};

export const endCall = async (_: any, { input }: { input: { callId: string } }, context: Context) => {
  if (!context.userId) throw new Error('Unauthorized');
  
  try {
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
    
    if (call.callerId !== context.userId && call.receiverId !== context.userId) {
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
      finalStatus = call.receiverId === context.userId ? 'REJECTED' : 'MISSED';
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
    
    // Publish to subscription
    await pubsub.publish('callEnded', { callEnded: endedCall });
    
    return endedCall;
  } catch (error) {
    console.error('Error ending call:', error);
    throw new Error('Failed to end call');
  }
};

export const addIceCandidate = async (_: any, { input }: { input: { callId: string, candidate: string } }, context: Context) => {
  if (!context.userId) throw new Error('Unauthorized');
  
  try {
    // Get the call
    const call = await prisma.call.findUnique({
      where: { id: input.callId }
    });
    
    if (!call) {
      throw new Error('Call not found');
    }
    
    if (call.callerId !== context.userId && call.receiverId !== context.userId) {
      throw new Error('You are not part of this call');
    }
    
    // Publish ICE candidate to the other participant
    await pubsub.publish('iceCandidateReceived', { 
      iceCandidateReceived: {
        callId: input.callId,
        candidate: input.candidate
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
    throw new Error('Failed to add ICE candidate');
  }
};

export const callSubscriptions = {
  callInitiated: {
    subscribe: (_: any, __: any, context: Context) => {
      if (!context.userId) throw new Error('Unauthorized');
      return pubsub.asyncIterator(['callInitiated']);
    },
    resolve: (payload: any) => {
      // Only notify the intended receiver
      if (payload.callInitiated.call.receiverId === context.userId) {
        return payload.callInitiated;
      }
      return null;
    }
  },
  callAnswered: {
    subscribe: (_: any, __: any, context: Context) => {
      if (!context.userId) throw new Error('Unauthorized');
      return pubsub.asyncIterator(['callAnswered']);
    },
    resolve: (payload: any) => {
      // Only notify the caller
      if (payload.callAnswered.call.callerId === context.userId) {
        return payload.callAnswered;
      }
      return null;
    }
  },
  callEnded: {
    subscribe: (_: any, __: any, context: Context) => {
      if (!context.userId) throw new Error('Unauthorized');
      return pubsub.asyncIterator(['callEnded']);
    },
    resolve: (payload: any) => {
      // Notify both participants
      if (payload.callEnded.callerId === context.userId || payload.callEnded.receiverId === context.userId) {
        return payload.callEnded;
      }
      return null;
    }
  },
  iceCandidateReceived: {
    subscribe: (_: any, __: any, context: Context) => {
      if (!context.userId) throw new Error('Unauthorized');
      return pubsub.asyncIterator(['iceCandidateReceived']);
    },
    resolve: (payload: any) => {
      // Get the call to check participants
      const call = prisma.call.findUnique({
        where: { id: payload.iceCandidateReceived.callId }
      });
      
      if (!call) return null;
      
      // Only notify the other participant
      if ((call.callerId === context.userId && call.receiverId !== context.userId) || 
          (call.receiverId === context.userId && call.callerId !== context.userId)) {
        return payload.iceCandidateReceived;
      }
      return null;
    }
  }
};