import type { APIRoute } from "astro";

import {
  deleteAdminMediaAssets,
  toggleMediaFeatured,
  updateMediaMeta,
  uploadAdminMedia,
  type AdminPostVisibility,
} from "../../../lib/admin";

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.currentUser;
  if (!currentUser || currentUser.role !== "admin") return respond(request, { error: "无权限" }, "/forbidden", 403);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "upload");
  const next = normalizeNext(String(formData.get("next") ?? ""));

  try {
    if (intent === "upload") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("请选择要上传的图片");

      const asset = await uploadAdminMedia({
        file,
        uploaderId: currentUser.id,
        visibility: parseVisibility(String(formData.get("visibility") ?? "public")),
        postId: String(formData.get("post_id") ?? "") || undefined,
        alt: String(formData.get("alt") ?? ""),
        caption: String(formData.get("caption") ?? ""),
        featured: formData.get("featured") === "on" || formData.get("featured") === "true",
      });

      return respond(request, { asset }, next || "/admin/media?success=uploaded");
    }

    if (intent === "featured") {
      await toggleMediaFeatured(String(formData.get("id") ?? ""), formData.get("featured") === "true");
      return respond(request, { ok: true }, next || "/admin/media?success=featured");
    }

    if (intent === "meta") {
      await updateMediaMeta(String(formData.get("id") ?? ""), {
        alt: String(formData.get("alt") ?? ""),
        caption: String(formData.get("caption") ?? ""),
      });
      return respond(request, { ok: true }, next || "/admin/media?success=updated");
    }

    if (intent === "delete") {
      const ids = [
        ...formData.getAll("ids").map(String),
        String(formData.get("id") ?? ""),
      ].flatMap((value) => value.split(","));
      await deleteAdminMediaAssets(ids);
      return respond(request, { ok: true }, next || "/admin/media?success=deleted");
    }

    throw new Error("未知操作");
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return respond(request, { error: message }, `/admin/media?error=${encodeURIComponent(message)}`, 400);
  }
};

function parseVisibility(value: string): AdminPostVisibility {
  return value === "private" ? "private" : "public";
}

function normalizeNext(next: string) {
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  return next;
}

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json")
    || request.headers.get("x-requested-with") === "fetch";
}

function respond(request: Request, data: unknown, redirectTo: string, status = 200) {
  if (wantsJson(request)) return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  return Response.redirect(new URL(redirectTo, request.url), 303);
}
