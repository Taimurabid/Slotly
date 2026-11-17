import { z } from 'zod';

export const RegisterBody = z.object({
  email: z.string().email(),
  // Upper bound is defensive, not a real limit: without one, a client could
  // send a multi-MB "password" and make argon2 do pointless expensive work.
  password: z.string().min(8).max(128),
  role: z.enum(['provider', 'customer']),
});

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

export const LogoutBody = z.object({
  refreshToken: z.string().min(1),
});

export const PublicUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['provider', 'customer']),
  createdAt: z.string(),
});

export const AuthResponse = z.object({
  user: PublicUser,
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const TokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
