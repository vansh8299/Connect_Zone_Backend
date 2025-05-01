import { PrismaClient } from "../../generated/prisma";

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  about: string | null;
  avatar: string | null;
  googleId: string | null;
  isEmailVerified: boolean;
}
export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  avatarBase64?: string;
}

export interface AuthPayload {
  token: string;
  user: User;
}

export interface Context {
  userId?: string;
  prisma: PrismaClient;
  user: User | null;
}
export interface LoginInput {
  email: string;
  password: string;
}

export interface GoogleAuthPayload {
  token: string;
  user: User;
  isNewUser: Boolean;
}
// In your types file
export interface UpdateUserInput {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  googleId?: string;
  avatar?: string;
  avatarBase64?: string; // Add this for base64 encoded images
  about?: string;
}
export interface UpdateUserResponse {
  updateUser: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    password?: string;
    about?: string;
    googleId?: string;

    isEmailVerified: boolean;
    avatar?: string;
  };
}
