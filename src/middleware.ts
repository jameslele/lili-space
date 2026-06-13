import { defineMiddleware } from "astro:middleware";

import { SESSION_COOKIE_NAME, getCurrentUserFromToken, isAdmin } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, locals, redirect, url } = context;
  const currentUser = await getCurrentUserFromToken(cookies.get(SESSION_COOKIE_NAME)?.value);
  locals.currentUser = currentUser;

  if (url.pathname.startsWith("/admin")) {
    if (!currentUser) {
      return redirect(`/login?next=${encodeURIComponent(url.pathname)}`, 303);
    }

    if (!isAdmin(currentUser)) {
      return redirect("/forbidden", 303);
    }
  }

  return next();
});
