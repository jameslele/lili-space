import type { APIRoute } from "astro";

import { createTag, updateTag } from "../../../lib/admin";

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!locals.currentUser || locals.currentUser.role !== "admin") {
    return redirect("/forbidden", 303);
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      await createTag({
        name: String(formData.get("name") ?? ""),
      });
      return redirect("/admin/tags?success=created", 303);
    }

    if (intent === "update") {
      await updateTag(String(formData.get("id") ?? ""), {
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      });
      return redirect("/admin/tags?success=updated", 303);
    }

    throw new Error("未知操作");
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return redirect(`/admin/tags?error=${encodeURIComponent(message)}`, 303);
  }
};
