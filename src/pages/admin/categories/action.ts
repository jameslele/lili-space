import type { APIRoute } from "astro";

import { createCategory, setCategoryVisible, updateCategory } from "../../../lib/admin";

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      await createCategory({
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        visible: formData.get("visible") === "on",
      });
      return redirect("/admin/categories?success=created", 303);
    }

    if (intent === "update") {
      const id = String(formData.get("id") ?? "");
      await updateCategory(id, {
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        description: String(formData.get("description") ?? ""),
        sortOrder: Number.parseInt(String(formData.get("sort_order") ?? "0"), 10) || 0,
        visible: String(formData.get("visible") ?? "true") === "true",
      });
      return redirect("/admin/categories?success=updated", 303);
    }

    if (intent === "visibility") {
      const id = String(formData.get("id") ?? "");
      await setCategoryVisible(id, formData.get("visible") === "true");
      return redirect("/admin/categories?success=visibility", 303);
    }

    throw new Error("未知操作");
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return redirect(`/admin/categories?error=${encodeURIComponent(message)}`, 303);
  }
};
