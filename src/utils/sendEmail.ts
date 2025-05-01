import nodemailer from "nodemailer";

// Interface for OTP storage
export interface OtpRecord {
  otp: string;
  expiresAt: Date;
  verified: boolean;
}

// In-memory OTP storage (consider using Redis in production)
export const otpStore = new Map<string, OtpRecord>();

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  debug: process.env.NODE_ENV !== "production", // Enable debug output in development
});

// Generate a random 6-digit OTP
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
export const sendOtpEmail = async (
  email: string,
  otp: string
): Promise<void> => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || "your-app@example.com",
    to: email,
    subject: "Email Verification OTP",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Verify Your Email</h2>
        <p>Thank you for signing up. Please use the following OTP to verify your email address:</p>
        <div style="background-color: #EEF2FF; padding: 12px; border-radius: 4px; margin: 20px 0; text-align: center;">
          <h3 style="font-size: 24px; letter-spacing: 6px; margin: 0; color: #4338CA;">${otp}</h3>
        </div>
        <p>This OTP will expire in 10 minutes.</p>
        <p>If you didn't request this verification, please ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};
