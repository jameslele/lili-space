import type { APIRoute } from "astro";

import { readSiteSettingsFromFormData, saveSiteSettings } from "../../../lib/site-settings";

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!locals.currentUser || locals.currentUser.role !== "admin") return redirect("/forbidden", 303);

  try {
    const formData = await request.formData();
    await saveSiteSettings(readSiteSettingsFromFormData(formData));
    return redirect("/admin/settings?success=saved", 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    return redirect(`/admin/settings?error=${encodeURIComponent(message)}`, 303);
  }
};
