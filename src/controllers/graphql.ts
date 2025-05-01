import { PrismaClient } from "../generated/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  User,
  SignupInput,
  AuthPayload,
  Context,
  LoginInput,
  GoogleAuthPayload,
  UpdateUserInput,
} from "../graphql/types/types";
import { generateOTP, otpStore, sendOtpEmail } from "../utils/sendEmail";
import { OAuth2Client } from "google-auth-library";
import { GraphQLError } from "graphql";
import { uploadImage } from "../utils/cloudinary";

const prisma = new PrismaClient();

export const getAllUsers = async (): Promise<User[]> => {
  try {
    const users = await prisma.user.findMany();
    return users.map((user) => ({
      ...user,
      password: user.password || "",
    }));
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }
    throw new Error("Failed to fetch users due to an unknown error");
  }
};

export const getUserById = async (
  _: unknown,
  { id }: { id: string }
): Promise<User> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    return { ...user, password: user.password || "" };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch user: ${error.message}`);
    }
    throw new Error("Failed to fetch user due to an unknown error");
  }
};

// export const signup = async (
//   _: unknown,
//   { input }: { input: SignupInput },
//   context?: Context
// ): Promise<AuthPayload> => {
//   const { firstName, lastName, email, password } = input;

//   try {

//     const existingUser = await prisma.user.findUnique({
//       where: { email },
//     });

//     if (existingUser) {
//       throw new Error(`User with email ${email} already exists`);
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     const newUser = await prisma.user.create({
//       data: {
//         firstName,
//         lastName,
//         email,
//         password: hashedPassword,
//       },
//     });

//     const token = jwt.sign(
//         {
//           userId: newUser.id,
//           email: newUser.email
//         },
//         process.env.JWT_SECRET || "your-secret-key",
//         { expiresIn: "1d" }
//       );

//     return {
//       token,
//       user: newUser,
//     };
//   } catch (error: unknown) {
//     if (error instanceof Error) {
//       throw new Error(`Signup failed: ${error.message}`);
//     }
//     throw new Error("Signup failed due to an unknown error");
//   }
// };

export const login = async (
  _: unknown,
  { input }: { input: LoginInput },
  context?: Context
): Promise<AuthPayload> => {
  const { email, password } = input;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error("Invalid email or password");
    }

    // Verify password
    if (!user.password) {
      throw new Error("Password is not set for this user");
    }
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      throw new Error("Invalid email or password");
    }

    // Generate JWT token with userId
    const token = jwt.sign(
      {
        userId: user.id,  // Make sure this property name matches what you check in context
        email: user.email,
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1d" }
    );

    return {
      token,
      user: { ...user, password: "" },
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Login failed: ${error.message}`);
    }
    throw new Error("Login failed due to an unknown error");
  }
};

export const sendOtp = async (
  _: unknown,
  { input }: { input: { email: string } }
) => {
  try {
    const { email } = input;

    // Check if email already exists in the database
    // const existingUser = await prisma.user.findUnique({
    //   where: { email },
    // });

    // if (existingUser) {
    //   throw new Error(`User with email ${email} already exists`);
    // }

    // Generate OTP
    const otp = generateOTP();

    // Store OTP with expiration time (10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    otpStore.set(email, {
      otp,
      expiresAt,
      verified: false,
    });

    // Send OTP via email
    await sendOtpEmail(email, otp);

    return {
      success: true,
      message: "OTP sent successfully to your email",
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        success: false,
        message: error.message,
      };
    }
    return {
      success: false,
      message: "Failed to send OTP",
    };
  }
};

// Verify OTP mutation
export const verifyOtp = async (
  _: unknown,
  { input }: { input: { email: string; otp: string } }
) => {
  try {
    const { email, otp } = input;

    const otpRecord = otpStore.get(email);

    if (!otpRecord) {
      throw new Error("No OTP found for this email. Please request a new OTP");
    }

    if (otpRecord.verified) {
      throw new Error("OTP already verified. Please proceed with signup");
    }

    if (new Date() > otpRecord.expiresAt) {
      // Remove expired OTP
      otpStore.delete(email);
      throw new Error("OTP has expired. Please request a new OTP");
    }

    if (otpRecord.otp !== otp) {
      throw new Error("Invalid OTP. Please try again");
    }

    // Mark OTP as verified
    otpStore.set(email, {
      ...otpRecord,
      verified: true,
    });

    return {
      success: true,
      message: "OTP verified successfully",
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        success: false,
        message: error.message,
      };
    }
    return {
      success: false,
      message: "Failed to verify OTP",
    };
  }
};

// Signup mutation (modified to check for verified OTP)
export const signup = async (
  _: unknown,
  {
    input,
  }: {
    input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      avatarBase64?: string;
    };
  },
  context?: Context
): Promise<AuthPayload> => {
  const { firstName, lastName, email, password, avatarBase64 } = input;

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error(`User with email ${email} already exists`);
    }

    // Verify that OTP was verified for this email
    const otpRecord = otpStore.get(email);
    if (!otpRecord || !otpRecord.verified) {
      throw new Error("Email not verified. Please verify your email first");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Prepare user data
    const userData: any = {
      firstName,
      lastName,
      email,
      password: hashedPassword,
      isEmailVerified: true,
      about: "Hey there! I am using ConnectZone.",
      avatar: null,
    };

    // Handle avatar base64 upload if provided
    if (avatarBase64) {
      // Extract mimetype and base64 data
      const matches = avatarBase64.match(/^data:(.+);base64,(.+)$/);

      if (matches && matches.length === 3) {
        const mimetype = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        // Prepare file data for cloudinary
        const fileData = {
          buffer,
          mimetype,
          originalname: "avatar.jpg",
        };

        // Upload to Cloudinary
        const avatarUrl = await uploadImage(fileData);
        userData.avatar = avatarUrl;
      }
    }

    // Create new user
    const newUser = await prisma.user.create({
      data: userData,
    });

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: newUser.id,
        email: newUser.email,
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1d" }
    );

    // Clear OTP from store after successful signup
    otpStore.delete(email);

    return {
      token,
      user: { ...(newUser || ""), password: newUser.password || "" },
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Signup failed: ${error.message}`);
    }
    throw new Error("Signup failed due to an unknown error");
  }
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleAuth = async (
  _: unknown,
  { input }: { input: { idToken: string } },
  context?: Context
): Promise<GoogleAuthPayload> => {
  try {
    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: input.idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new Error("Invalid Google token");
    }

    const { email, sub: googleId, given_name, family_name, picture } = payload;

    // Check if user exists with this Google ID or email
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email }],
      },
    });

    let isNewUser = false;

    if (!user) {
      // Create new user
      isNewUser = true;
      user = await prisma.user.create({
        data: {
          email,
          googleId,
          firstName: given_name || "Google",
          lastName: family_name || "User",
          about: "Hey there! I am using ConnectZone.",
          avatar: picture || null,
          isEmailVerified: true,
        },
      });
    } else if (!user.googleId) {
      // Link Google account to existing email account
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          isEmailVerified: true,
          avatar: user.avatar || picture || null,
        },
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1d" }
    );

    return {
      token,
      user: { ...user, password: user.password || "" },
      isNewUser,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Google authentication failed: ${error.message}`);
    }
    throw new Error("Google authentication failed due to an unknown error");
  }
};

export const updateUser = async (
  _: any,
  { input }: { input: UpdateUserInput },
  context: Context
) => {
  try {
    console.log("Context userId:", context.userId);
    console.log("Input ID:", input.id);

    // Update fields
    const updateFields: any = {};

    // Only add fields that are provided in the input
    if (input.firstName !== undefined) updateFields.firstName = input.firstName;
    if (input.lastName !== undefined) updateFields.lastName = input.lastName;
    if (input.email !== undefined) updateFields.email = input.email;
    if (input.password !== undefined) {
      const hashedPassword = await bcrypt.hash(input.password, 10);
      updateFields.password = hashedPassword;
    }
    if (input.googleId !== undefined) updateFields.googleId = input.googleId;
    if (input.about !== undefined) updateFields.about = input.about;

    // Handle avatar base64 upload if provided
    if (input.avatarBase64) {
      // Extract mimetype and base64 data
      const matches = input.avatarBase64.match(/^data:(.+);base64,(.+)$/);

      if (matches && matches.length === 3) {
        const mimetype = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        // Prepare file data for cloudinary
        const fileData = {
          buffer,
          mimetype,
          originalname: "avatar.jpg",
        };

        // Upload to Cloudinary
        const avatarUrl = await uploadImage(fileData);
        updateFields.avatar = avatarUrl;
      }
    } else if (input.avatar !== undefined) {
      // If a direct avatar URL is provided
      updateFields.avatar = input.avatar;
    }

    // Update user using Prisma
    const updatedUser = await prisma.user.update({
      where: { id: input.id },
      data: updateFields,
    });

    if (!updatedUser) {
      throw new GraphQLError("User not found", {
        extensions: {
          code: "NOT_FOUND",
          http: { status: 404 },
        },
      });
    }

    return updatedUser;
  } catch (error: any) {
    if (error instanceof GraphQLError) {
      throw error;
    }

    // Handle Prisma errors
    if (error.code === "P2025") {
      throw new GraphQLError("User not found", {
        extensions: {
          code: "NOT_FOUND",
          http: { status: 404 },
        },
      });
    }

    throw new GraphQLError(`Failed to update user: ${error.message}`, {
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        http: { status: 500 },
      },
    });
  }
};
export const updatePassword = async (
  _: unknown,
  { input }: { input: { email: string; password: string } }
) => {
  try {
    const { email, password } = input;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error("No user found with this email address");
    }

    // Check if OTP was verified for this email
    const otpRecord = otpStore.get(email);
    if (!otpRecord || !otpRecord.verified) {
      throw new Error("Email verification required before changing password");
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update the user's password
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    // Clear the OTP record after successful password update
    otpStore.delete(email);

    return {
      success: true,
      message: "Password updated successfully",
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return {
        success: false,
        message: error.message,
      };
    }
    return {
      success: false,
      message: "Failed to update password",
    };
  }
};
