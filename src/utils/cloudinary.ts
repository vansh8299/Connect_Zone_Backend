// src/utils/cloudinary.ts
import { v2 as cloudinary } from "cloudinary";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Generic file interface that doesn't depend on Express
export interface FileData {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

export const uploadImage = async (file: FileData): Promise<string> => {
  try {
    // Convert file buffer to base64
    const fileStr = `data:${file.mimetype};base64,${file.buffer.toString(
      "base64"
    )}`;

    // Upload to cloudinary
    const uploadedResponse = await cloudinary.uploader.upload(fileStr, {
      folder: "user_avatars",
      transformation: [
        { width: 300, height: 300, crop: "fill" },
        { quality: "auto" },
      ],
    });

    return uploadedResponse.secure_url;
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    throw new Error("Failed to upload image");
  }
};
export const uploadGroupAvatar = async (file: FileData): Promise<string> => {
  try {
    // Convert file buffer to base64
    const fileStr = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    
    // Upload to cloudinary with group-specific settings
    const uploadedResponse = await cloudinary.uploader.upload(fileStr, {
      folder: "group_avatars", // Different folder for group avatars
      transformation: [
        { width: 300, height: 300, crop: "fill" },
        { quality: "auto" },
        { format: "auto" } // Auto-optimize format
      ],
    });
    
    return uploadedResponse.secure_url;
  } catch (error) {
    console.error("Error uploading group avatar to Cloudinary:", error);
    throw new Error("Failed to upload group avatar");
  }
};