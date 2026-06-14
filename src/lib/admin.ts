import { createServiceRoleSupabaseClient } from "./supabase/server";

export type AdminPostStatus = "draft" | "published" | "archived";
export type AdminPostVisibility = "public" | "private";
export type AdminPostFilter = "all" | AdminPostStatus | AdminPostVisibility;

export interface AdminPost {
  id: string;
  title: string;
  slug: string;
  status: AdminPostStatus;
  visibility: AdminPostVisibility;
  noindex: boolean;
  published_at: string | null;
  updated_at: string;
  created_at: string;
  category: AdminCategory | null;
  tags: AdminTag[];
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  visible: boolean;
  created_at?: string;
  updated_at?: string;
  postCount?: number;
}

export interface AdminTag {
  id: string;
  name: string;
  slug: string;
  created_at?: string;
  postCount?: number;
}

export interface AdminMediaAsset {
  id: string;
  file_name: string;
  mime_type: string;
  bucket: string;
  storage_path: string;
  public_url: string;
  featured: boolean;
  created_at: string;
  size_bytes: number | null;
  posts: { id: string; title: string; slug: string } | { id: string; title: string; slug: string }[] | null;
}

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "reader";
  created_at: string;
}

export interface AdminSiteSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

const postSelect = `
  id,
  title,
  slug,
  status,
  visibility,
  noindex,
  published_at,
  updated_at,
  created_at,
  categories (
    id,
    name,
    slug,
    description,
    sort_order,
    visible
  )
`;

export async function getAdminDashboardStats() {
  const supabase = createServiceRoleSupabaseClient();
  const [
    posts,
    published,
    drafts,
    privatePosts,
    categories,
    tags,
    media,
    users,
    recentPosts,
  ] = await Promise.all([
    countRows("posts"),
    countRows("posts", { status: "published" }),
    countRows("posts", { status: "draft" }),
    countRows("posts", { visibility: "private" }),
    countRows("categories"),
    countRows("tags"),
    countRows("media_assets"),
    countRows("users"),
    supabase
      .from("posts")
      .select(postSelect)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  if (recentPosts.error) throw recentPosts.error;

  return {
    counts: {
      posts,
      published,
      drafts,
      privatePosts,
      categories,
      tags,
      media,
      users,
    },
    recentPosts: await attachTags((recentPosts.data ?? []) as RawAdminPost[]),
  };
}

export async function listAdminPosts(filter: AdminPostFilter = "all") {
  let query = createServiceRoleSupabaseClient()
    .from("posts")
    .select(postSelect)
    .order("updated_at", { ascending: false });

  if (filter === "draft" || filter === "published" || filter === "archived") {
    query = query.eq("status", filter);
  } else if (filter === "public" || filter === "private") {
    query = query.eq("visibility", filter);
  }

  const { data, error } = await query;
  if (error) throw error;

  return attachTags((data ?? []) as RawAdminPost[]);
}

export async function getAdminPostById(id: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("posts").select(`${postSelect}, excerpt, cover_url, markdown`).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [post] = await attachTags([data as RawAdminPost]);
  return {
    ...post,
    excerpt: (data as { excerpt: string | null }).excerpt,
    cover_url: (data as { cover_url: string | null }).cover_url,
    markdown: (data as { markdown: string }).markdown,
  };
}

export async function listAdminCategories() {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
  if (error) throw error;

  const counts = await countPostsByColumn("category_id");
  return ((data ?? []) as AdminCategory[]).map((category) => ({
    ...category,
    postCount: counts.get(category.id) ?? 0,
  }));
}

export async function listAdminTags() {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("tags").select("*").order("created_at", { ascending: false });
  if (error) throw error;

  const { data: rows, error: rowsError } = await supabase.from("post_tags").select("tag_id");
  if (rowsError) throw rowsError;

  const counts = new Map<string, number>();
  for (const row of rows ?? []) counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1);

  return ((data ?? []) as AdminTag[]).map((tag) => ({
    ...tag,
    postCount: counts.get(tag.id) ?? 0,
  }));
}

export async function listAdminMedia(options: { featuredOnly?: boolean } = {}) {
  let query = createServiceRoleSupabaseClient()
    .from("media_assets")
    .select("id, file_name, mime_type, bucket, storage_path, public_url, featured, created_at, size_bytes, posts!media_assets_post_id_fkey(id, title, slug)")
    .order("created_at", { ascending: false });

  if (options.featuredOnly) query = query.eq("featured", true);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AdminMediaAsset[];
}

export async function listAdminUsers() {
  const { data, error } = await createServiceRoleSupabaseClient()
    .from("users")
    .select("id, username, display_name, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}

export async function listAdminSiteSettings() {
  const { data, error } = await createServiceRoleSupabaseClient()
    .from("site_settings")
    .select("key, value, updated_at")
    .order("key", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminSiteSetting[];
}

export async function createCategory(input: { name: string; slug?: string; description?: string; sortOrder?: number; visible?: boolean }) {
  const name = input.name.trim();
  if (!name) throw new Error("分类名称不能为空");

  const { error } = await createServiceRoleSupabaseClient().from("categories").insert({
    name,
    slug: normalizeSlug(input.slug || name),
    description: input.description?.trim() || null,
    sort_order: input.sortOrder ?? 0,
    visible: input.visible ?? true,
  });

  if (error) throw error;
}

export async function updateCategory(id: string, input: { name: string; slug?: string; description?: string; sortOrder?: number; visible?: boolean }) {
  const name = input.name.trim();
  if (!name) throw new Error("分类名称不能为空");
  const nextDescription = input.description?.trim();
  const payload: {
    name: string;
    slug: string;
    description?: string;
    sort_order: number;
    visible: boolean;
  } = {
    name,
    slug: normalizeSlug(input.slug || name),
    sort_order: input.sortOrder ?? 0,
    visible: input.visible ?? true,
  };

  if (nextDescription) payload.description = nextDescription;

  const { error } = await createServiceRoleSupabaseClient()
    .from("categories")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
}

export async function setCategoryVisible(id: string, visible: boolean) {
  const { error } = await createServiceRoleSupabaseClient().from("categories").update({ visible }).eq("id", id);
  if (error) throw error;
}

export async function createTag(input: { name: string; slug?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("标签名称不能为空");

  const { error } = await createServiceRoleSupabaseClient().from("tags").insert({
    name,
    slug: normalizeSlug(input.slug || name),
  });

  if (error) throw error;
}

export async function updateTag(id: string, input: { name: string; slug?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("标签名称不能为空");

  const { error } = await createServiceRoleSupabaseClient()
    .from("tags")
    .update({
      name,
      slug: normalizeSlug(input.slug || name),
    })
    .eq("id", id);

  if (error) throw error;
}

export function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug) throw new Error("Slug 不能为空");
  return slug;
}

export function formatAdminDate(value: string | null | undefined) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return "未知";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type RawAdminPost = Omit<AdminPost, "category" | "tags"> & {
  categories: AdminCategory | AdminCategory[] | null;
};

async function countRows(table: string, filters: Record<string, string> = {}) {
  let query = createServiceRoleSupabaseClient().from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function countPostsByColumn(column: "category_id") {
  const { data, error } = await createServiceRoleSupabaseClient().from("posts").select(column);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row[column];
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function attachTags(rawPosts: RawAdminPost[]) {
  const ids = rawPosts.map((post) => post.id);
  if (ids.length === 0) return [] as AdminPost[];

  const { data, error } = await createServiceRoleSupabaseClient().from("post_tags").select("post_id, tags(id, name, slug)").in("post_id", ids);
  if (error) throw error;

  const tagMap = new Map<string, AdminTag[]>();
  for (const row of data ?? []) {
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tag) continue;
    const tags = tagMap.get(row.post_id) ?? [];
    tags.push(tag as AdminTag);
    tagMap.set(row.post_id, tags);
  }

  return rawPosts.map((post) => {
    const category = Array.isArray(post.categories) ? post.categories[0] : post.categories;
    return {
      ...post,
      category,
      tags: tagMap.get(post.id) ?? [],
    };
  });
}
