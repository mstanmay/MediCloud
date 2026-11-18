import dotenv from 'dotenv';
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  tz: process.env.TZ || 'Asia/Kolkata',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret:
    process.env.JWT_SECRET ||
    'medicloud-dev-signing-secret-change-in-production-2026',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  awsRegion: process.env.AWS_REGION || '',
  awsS3Bucket: process.env.AWS_S3_BUCKET || '',
  awsSesFromEmail: process.env.AWS_SES_FROM_EMAIL || '',
};

export function isS3Configured(): boolean {
  return Boolean(
    env.awsRegion &&
      env.awsS3Bucket &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function isSesConfigured(): boolean {
  return Boolean(
    env.awsRegion &&
      env.awsSesFromEmail &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}
