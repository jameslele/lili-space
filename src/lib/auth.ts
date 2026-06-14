import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";

import { createServiceRoleSupabaseClient } from "./supabase/server";

export const SESSION_COOKIE_NAME = "lili_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_SALT_ROUNDS = 12;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type UserRole = "admin" | "reader";

export interface CurrentUser {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
}

interface UserRecord extends CurrentUser {
  password_hash: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName?: string;
}) {
  const username = normalizeUsername(input.username);
  const password = input.password.trim();
  const displayName = input.displayName?.trim() || username;

  if (!username || !password) {
    throw new AuthError("用户名和密码不能为空");
  }

  if (password.length < 4) {
    throw new AuthError("密码至少需要 4 个字符");
  }

  const passwordHash = await hashPassword(password);
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .insert({
      username,
      password_hash: passwordHash,
      display_name: displayName,
      role: "reader",
    })
    .select("id, username, display_name, role")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AuthError("用户名已被使用");
    }
    throw error;
  }

  return data as CurrentUser;
}

export async function loginUser(usernameInput: string, password: string) {
  const username = normalizeUsername(usernameInput);
  if (!username || !password) return null;

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, username, display_name, role, password_hash")
    .eq("username", username)
    .single();

  if (error || !data) return null;

  const user = data as UserRecord;
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return toCurrentUser(user);
}

export async function createSession(userId: string) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    last_seen_at: new Date().toISOString(),
  });

  if (error) throw error;

  return { token, expiresAt };
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;

  const supabase = createServiceRoleSupabaseClient();
  await supabase.from("sessions").delete().eq("token_hash", hashSessionToken(token));
}

export async function getCurrentUserFromToken(token: string | undefined) {
  if (!token) return null;

  const supabase = createServiceRoleSupabaseClient();
  const tokenHash = hashSessionToken(token);
  const { data, error } = await supabase
    .from("sessions")
    .select("id, expires_at, last_seen_at, users(id, username, display_name, role)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await supabase.from("sessions").delete().eq("token_hash", tokenHash);
    return null;
  }

  if (shouldTouchSession(data.last_seen_at)) {
    await supabase
      .from("sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("token_hash", tokenHash);
  }

  const user = Array.isArray(data.users) ? data.users[0] : data.users;
  if (!user) return null;

  return user as CurrentUser;
}

function shouldTouchSession(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return true;
  const lastSeenTime = new Date(lastSeenAt).getTime();
  if (Number.isNaN(lastSeenTime)) return true;
  return Date.now() - lastSeenTime > SESSION_TOUCH_INTERVAL_MS;
}

export function isAdmin(user: CurrentUser | null | undefined) {
  return user?.role === "admin";
}

export function getCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: import.meta.env.PROD,
    path: "/",
    expires: expiresAt ? new Date(expiresAt) : undefined,
    maxAge: expiresAt ? SESSION_MAX_AGE_SECONDS : undefined,
  };
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function toCurrentUser(user: UserRecord): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  };
}
