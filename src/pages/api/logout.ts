import type { APIRoute } from "astro";

import { SESSION_COOKIE_NAME, deleteSession, serializeDeletedSessionCookie } from "../../lib/auth";

export const POST: APIRoute = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  await deleteSession(token);
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": serializeDeletedSessionCookie(),
    },
  });
};
