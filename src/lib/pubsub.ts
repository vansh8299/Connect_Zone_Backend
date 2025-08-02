// src/lib/pubsub.ts
import { PubSub } from 'graphql-subscriptions';

// Define your subscription events
type PubSubChannels = {
  callInitiated: [payload: { callInitiated: any }];
  callAnswered: [payload: { callAnswered: any }];
  callEnded: [payload: { callEnded: any }];
  iceCandidateReceived: [payload: { iceCandidateReceived: any }];
  messageSent: [payload: { messageSent: any }];
  newMessage: [payload: { newMessage: any }];
};

// Create a typed PubSub instance
export const pubsub = new PubSub() as PubSub<PubSubChannels>;