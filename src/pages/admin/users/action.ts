import type { APIRoute } from "astro";

import { deleteAdminReaderUser } from "../../../lib/admin";

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const currentUser = locals.currentUser;
  if (!currentUser || currentUser.role !== "admin") return redirect("/forbidden", 303);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "delete") {
      await deleteAdminReaderUser(String(formData.get("id") ?? ""), currentUser.id);
      return redirect("/admin/users?success=deleted", 303);
    }

    throw new Error("未知操作");
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return redirect(`/admin/users?error=${encodeURIComponent(message)}`, 303);
  }
};
