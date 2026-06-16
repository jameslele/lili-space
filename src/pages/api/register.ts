import type { APIRoute } from "astro";

import {
  AuthError,
  createSession,
  registerUser,
  serializeSessionCookie,
} from "../../lib/auth";

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const displayName = String(form.get("display_name") ?? "");
  const password = String(form.get("password") ?? "");

  try {
    const user = await registerUser({ username, displayName, password });
    const session = await createSession(user.id);
    return redirectWithCookie("/", serializeSessionCookie(session.token, session.expiresAt));
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "注册失败，请稍后再试";
    return redirect(`/register?error=${encodeURIComponent(message)}`, 303);
  }
};

function redirectWithCookie(location: string, cookie: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Set-Cookie": cookie,
    },
  });
}
