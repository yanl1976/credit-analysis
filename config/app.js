import 'dotenv/config';

export const appConfig = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtAccessExpireMin: Number(process.env.JWT_ACCESS_EXPIRE_MINUTES || 30),
  jwtRefreshExpireDays: Number(process.env.JWT_REFRESH_EXPIRE_DAYS || 7),
};
