import type { APIRoute } from "astro";

import { saveAdminPost, type AdminPostVisibility, type SaveAdminPostInput } from "../../../lib/admin";

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const currentUser = locals.currentUser;
  if (!currentUser || currentUser.role !== "admin") return redirect("/forbidden", 303);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "draft") as SaveAdminPostInput["intent"];
  const id = String(formData.get("id") ?? "").trim();

  try {
    const postId = await saveAdminPost({
      id: id || undefined,
      title: String(formData.get("title") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      excerpt: String(formData.get("excerpt") ?? ""),
      markdown: String(formData.get("markdown") ?? ""),
      categoryId: String(formData.get("category_id") ?? "") || undefined,
      newCategoryName: String(formData.get("new_category_name") ?? ""),
      tagNames: parseTagNames(String(formData.get("tag_names") ?? "[]")),
      coverUrl: String(formData.get("cover_url") ?? ""),
      coverAssetId: String(formData.get("cover_asset_id") ?? "") || undefined,
      visibility: parseVisibility(String(formData.get("visibility") ?? "public")),
      noindex: formData.get("show_on_home") !== "on",
      publishedAt: String(formData.get("published_at") ?? "") || undefined,
      intent,
    }, currentUser.id);

    const success = intent === "publish" ? "published" : intent === "archive" ? "archived" : "saved";
    return redirect(`/admin/posts/${postId}?success=${success}`, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    const target = id ? `/admin/posts/${id}` : "/admin/posts/new";
    return redirect(`${target}?error=${encodeURIComponent(message)}`, 303);
  }
};

function parseVisibility(value: string): AdminPostVisibility {
  return value === "private" ? "private" : "public";
}

function parseTagNames(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}
