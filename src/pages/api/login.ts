import type { APIRoute } from "astro";

import {
  SESSION_COOKIE_NAME,
  createSession,
  getCookieOptions,
  loginUser,
} from "../../lib/auth";

const INVALID_LOGIN = "账号或密码不正确";

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = normalizeNext(String(form.get("next") ?? url.searchParams.get("next") ?? ""));

  const user = await loginUser(username, password);
  if (!user) {
    return redirect(`/login?error=${encodeURIComponent(INVALID_LOGIN)}&next=${encodeURIComponent(next)}`, 303);
  }

  const session = await createSession(user.id);
  cookies.set(SESSION_COOKIE_NAME, session.token, getCookieOptions(session.expiresAt));

  return redirect(next || (user.role === "admin" ? "/admin" : "/"), 303);
};

function normalizeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  return next;
}
