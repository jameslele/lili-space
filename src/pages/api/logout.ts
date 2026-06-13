import type { APIRoute } from "astro";

import { SESSION_COOKIE_NAME, deleteSession } from "../../lib/auth";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  await deleteSession(token);
  cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
  return redirect("/", 303);
};
