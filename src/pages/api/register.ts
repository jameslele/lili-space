import type { APIRoute } from "astro";

import {
  AuthError,
  SESSION_COOKIE_NAME,
  createSession,
  getCookieOptions,
  registerUser,
} from "../../lib/auth";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const displayName = String(form.get("display_name") ?? "");
  const password = String(form.get("password") ?? "");

  try {
    const user = await registerUser({ username, displayName, password });
    const session = await createSession(user.id);
    cookies.set(SESSION_COOKIE_NAME, session.token, getCookieOptions(session.expiresAt));
    return redirect("/", 303);
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "注册失败，请稍后再试";
    return redirect(`/register?error=${encodeURIComponent(message)}`, 303);
  }
};
