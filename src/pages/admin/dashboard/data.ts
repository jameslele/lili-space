import type { APIRoute } from "astro";

import { getAdminDashboardStats } from "../../../lib/admin";

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.currentUser || locals.currentUser.role !== "admin") {
    return new Response(JSON.stringify({ error: "无权限" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const stats = await getAdminDashboardStats();
    return new Response(JSON.stringify(stats), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "加载失败" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
