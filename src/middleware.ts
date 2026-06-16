import { defineMiddleware } from "astro:middleware";

import { SESSION_COOKIE_NAME, getCurrentUserFromToken, isAdmin } from "./lib/auth";

const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];
const PRODUCTION_HOSTNAME = "lili-space-only-mainland-k5jdl5gj.zh-cn.edgeone.cool";
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, locals, redirect, url } = context;
  if (isForbiddenCrossSiteFormPost(context.request, url)) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
  }

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

function isForbiddenCrossSiteFormPost(request: Request, url: URL) {
  if (SAFE_METHODS.includes(request.method)) return false;

  const contentType = request.headers.get("content-type");
  const shouldCheckOrigin =
    !contentType || FORM_CONTENT_TYPES.some((formContentType) => contentType.toLowerCase().includes(formContentType));
  if (!shouldCheckOrigin) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  return !isAllowedPostOrigin(origin, url);
}

function isAllowedPostOrigin(origin: string, url: URL) {
  if (origin === url.origin) return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "https:" && originUrl.hostname === PRODUCTION_HOSTNAME;
  } catch {
    return false;
  }
}
