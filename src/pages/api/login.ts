import type { APIRoute } from "astro";

import {
  createSession,
  loginUser,
  serializeSessionCookie,
} from "../../lib/auth";

const INVALID_LOGIN = "账号或密码不正确";

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = normalizeNext(String(form.get("next") ?? url.searchParams.get("next") ?? ""));

  const user = await loginUser(username, password);
  if (!user) {
    return redirect(`/login?error=${encodeURIComponent(INVALID_LOGIN)}&next=${encodeURIComponent(next)}`, 303);
  }

  const session = await createSession(user.id);
  return redirectWithCookie(
    next || (user.role === "admin" ? "/admin" : "/"),
    serializeSessionCookie(session.token, session.expiresAt),
  );
};

function normalizeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  return next;
}

function redirectWithCookie(location: string, cookie: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Set-Cookie": cookie,
    },
  });
}
