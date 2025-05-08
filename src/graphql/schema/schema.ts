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


type Subscription {
  messageSent(conversationId: ID!): Message!
  newMessage: Message!
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
}

input UpdateGroupInput {
  groupId: ID!
  name: String
  description: String
  avatar: String
}


extend type Query {
  getGroup(groupId: ID!): Group
  getUserGroups: [Group!]!
}
  type Query {
  users: [User]
  user(id: ID!): User
  userByEmail(email: String!): User
  searchUsers(searchTerm: String!): [User]
  getConversations: [Conversation!]!

  getMessages(conversationId: ID!): [Message!]!
}
type Mutation {
  signup(input: SignupInput!): AuthPayload!
  login(input: LoginInput!): AuthPayload!
  sendOtp(input: SendOtpInput!): SendOtpResponse!
  verifyOtp(input: VerifyOtpInput!): VerifyOtpResponse!
  googleAuth(input: GoogleAuthInput!): GoogleAuthPayload!
  updateUser(input: UpdateUserInput!): UpdateUserResponse!
  updatePassword(input: UpdatePasswordInput!): UpdatePasswordResponse!
  createConversation(participantIds: [ID!]!): Conversation!
  sendMessage(input: SendMessageInput!): Message!
  markAsRead(messageId: ID!): Message!
   createGroup(input: CreateGroupInput!): Group!
  updateGroup(input: UpdateGroupInput!): Group!
  addGroupParticipants(groupId: ID!, participantIds: [ID!]!): Group!
  removeGroupParticipant(groupId: ID!, participantId: ID!): Group!
  leaveGroup(groupId: ID!): Boolean!
  deleteGroup(groupId: ID!): Boolean!
}
`;
