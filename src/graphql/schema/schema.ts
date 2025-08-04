export const graphQLSchema = `#graphql
type User {
  id: ID!
  firstName: String!
  lastName: String!
  email: String!
  password: String!
  googleId: String
  avatar: String
  isEmailVerified: Boolean
  about: String
  createdAt: String!
  updatedAt: String!
}

input LoginInput {
  email: String!
  password: String!
}

input SignupInput {
 firstName: String!
 lastName: String!
 email: String!
 password: String!
 avatarBase64: String
}

input SendOtpInput {
  email: String!
}

input VerifyOtpInput {
  email: String!
  otp: String!
}

type SendOtpResponse {
  success: Boolean!
  message: String!
}

type VerifyOtpResponse {
  success: Boolean!
  message: String!
}

type AuthPayload {
  token: String!
  user: User!
}

input GoogleAuthInput {
  idToken: String!
}

type GoogleAuthPayload {
  token: String!
  user: User!
  isNewUser: Boolean!
}

scalar Upload

input UpdateUserInput {
  id: String
  firstName: String
  lastName: String
  email: String
  password: String
  googleId: String
  avatar: String
  avatarBase64: String  
  about: String
}

type UpdateUserResponse {
  id: ID!
  firstName: String!
  lastName: String!
  email: String!
  password: String
  googleId: String
  avatar: String
  isEmailVerified: Boolean
  about: String
}

type UpdatePasswordResponse {
  success: Boolean!
  message: String!
}

input UpdatePasswordInput {
  email: String!
  password: String!
}

type Message {
  id: ID!
  content: String!
  sender: User!
  conversationId: String!
  readBy: [MessageRead!]!
  createdAt: String!
  updatedAt: String!
  type: MessageType!
  deletedFor: [String!]!
}

enum DeleteType {
  DELETE_FOR_EVERYONE
  DELETE_FOR_ME
}

input DeleteMessageInput {
  messageId: ID!
  deleteType: DeleteType!
}

type MessageRead {
  id: ID!
  message: Message!
  user: User!
  readAt: String!
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  AUDIO
  VIDEO
}

type Conversation {
  id: ID!
  name: String
  participants: [ConversationParticipant!]!
  messages: [Message!]!
  isGroup: Boolean!
  group: Group
  createdAt: String!
  updatedAt: String!
}

type ConversationParticipant {
  id: ID!
  user: User!
  conversation: Conversation!
  joinedAt: String!
  leftAt: String
}

input SendMessageInput {
  conversationId: ID!
  content: String!
}

type Group {
  id: ID!
  name: String!
  description: String
  avatar: String
  createdAt: String!
  updatedAt: String!
  creator: User!
  conversation: Conversation!
  participants: [ConversationParticipant!]!
}

input CreateGroupInput {
  name: String!
  description: String
  participantIds: [ID!]!
  avatarBase64: String
}

input UpdateGroupInput {
  groupId: ID!
  name: String
  description: String
  avatarBase64: String 
}

input UpdateMessageInput {
  messageId: ID!
  newContent: String!
}

type Call {
  id: ID!
  caller: User!
  receiver: User!
  status: CallStatus!
  startedAt: String!
  endedAt: String
  duration: Int
}

enum CallStatus {
  INITIATED
  ONGOING
  REJECTED
  MISSED
  COMPLETED
}

type CallPayload {
  call: Call!
  sdpOffer: String
  iceCandidate: String
}

type IceCandidatePayload {
  callId: ID!
  candidate: String!
}

input StartCallInput {
  receiverId: ID!
}

input AnswerCallInput {
  callId: ID!
  sdpAnswer: String!
}

input IceCandidateInput {
  callId: ID!
  candidate: String!
}

input EndCallInput {
  callId: ID!
}

type DeleteMessageResponse {
  success: Boolean!
  messageId: ID!
  conversationId: ID!
  deleteType: DeleteType!
}

type Query {
  users: [User]
  user(id: ID!): User
  userByEmail(email: String!): User
  searchUsers(searchTerm: String!): [User]
  getConversations: [Conversation!]!
  getCall(id: ID!): Call
  getCallHistory: [Call!]!
  getMessages(conversationId: ID!): [Message!]!
  getGroup(groupId: ID!): Group
  getUserGroups: [Group!]!
  currentUser: User!
}

type Mutation {
  signup(input: SignupInput!): AuthPayload!
  login(input: LoginInput!): AuthPayload!
  sendOtp(input: SendOtpInput!): SendOtpResponse!
  verifyOtp(input: VerifyOtpInput!): VerifyOtpResponse!
  googleAuth(input: GoogleAuthInput!): GoogleAuthPayload!
  updateUser(input: UpdateUserInput!): UpdateUserResponse!
  updateMessage(input: UpdateMessageInput!): Message!
  updatePassword(input: UpdatePasswordInput!): UpdatePasswordResponse!
  deleteMessage(input: DeleteMessageInput!): DeleteMessageResponse!
  createConversation(participantIds: [ID!]!): Conversation!
  sendMessage(input: SendMessageInput!): Message!
  markAsRead(messageId: ID!): Message!
  startCall(input: StartCallInput!): CallPayload!
  answerCall(input: AnswerCallInput!): CallPayload!
  endCall(input: EndCallInput!): Call!
  addIceCandidate(input: IceCandidateInput!): Boolean!
  createGroup(input: CreateGroupInput!): Group!
  updateGroup(input: UpdateGroupInput!): Group!
  addGroupParticipants(groupId: ID!, participantIds: [ID!]!): Group!
  removeGroupParticipant(groupId: ID!, participantId: ID!): Group!
  leaveGroup(groupId: ID!): Boolean!
  deleteGroup(groupId: ID!): Boolean!
}

type Subscription {
  messageSent(conversationId: ID!): Message!
  newMessage: Message!
  callInitiated: CallPayload!
  callAnswered(callId: ID!): CallPayload!
  callEnded(callId: ID!): Call!
  iceCandidateReceived(callId: ID!): IceCandidatePayload!
}
`;