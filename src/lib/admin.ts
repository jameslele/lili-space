import { createServiceRoleSupabaseClient } from "./supabase/server";
import { supabaseEnv } from "./supabase-env";

export type AdminPostStatus = "draft" | "published" | "archived";
export type AdminPostVisibility = "public" | "private";
export type AdminPostFilter = "all" | AdminPostStatus | AdminPostVisibility;

export interface AdminPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  markdown?: string;
  cover_url?: string | null;
  cover_asset_id?: string | null;
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
  display_url?: string;
  alt: string | null;
  caption: string | null;
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

export interface SaveAdminPostInput {
  id?: string;
  title: string;
  slug?: string;
  excerpt?: string;
  markdown?: string;
  categoryId?: string;
  newCategoryName?: string;
  tagNames?: string[];
  coverUrl?: string;
  coverAssetId?: string;
  visibility: AdminPostVisibility;
  noindex: boolean;
  publishedAt?: string;
  intent: "draft" | "publish" | "archive";
}

export interface UploadAdminMediaInput {
  file: File;
  uploaderId: string;
  visibility: AdminPostVisibility;
  postId?: string;
  alt?: string;
  caption?: string;
  featured?: boolean;
}

export interface AdminMediaListOptions {
  featuredOnly?: boolean;
  page?: number;
  pageSize?: number;
  query?: string;
  type?: "all" | "image" | "audio" | "video" | "other";
  visibility?: "all" | AdminPostVisibility;
  featured?: "all" | "featured" | "normal";
  relation?: "all" | "linked" | "unlinked";
}

export interface AdminMediaListResult {
  assets: AdminMediaAsset[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminPostListResult {
  posts: AdminPost[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
  const result = await listAdminPostsPage({ filter, page: 1, pageSize: 500 });
  return result.posts;
}

export async function listAdminPostsPage(options: { filter?: AdminPostFilter; page?: number; pageSize?: number } = {}): Promise<AdminPostListResult> {
  const filter = options.filter ?? "all";
  const pageSize = clampInteger(options.pageSize ?? 20, 10, 60);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = createServiceRoleSupabaseClient()
    .from("posts")
    .select(postSelect, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (filter === "draft" || filter === "published" || filter === "archived") {
    query = query.eq("status", filter);
  } else if (filter === "public" || filter === "private") {
    query = query.eq("visibility", filter);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const posts = await attachTags((data ?? []) as RawAdminPost[]);
  const total = count ?? 0;
  return {
    posts,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminPostById(id: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("posts").select(`${postSelect}, excerpt, cover_url, cover_asset_id, markdown`).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [post] = await attachTags([data as RawAdminPost]);
  return {
    ...post,
    excerpt: (data as { excerpt: string | null }).excerpt,
    cover_url: (data as { cover_url: string | null }).cover_url,
    cover_asset_id: (data as { cover_asset_id: string | null }).cover_asset_id,
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
  const result = await listAdminMediaPage({
    featuredOnly: options.featuredOnly,
    page: 1,
    pageSize: 500,
  });
  return result.assets;
}

export async function listAdminMediaPage(options: AdminMediaListOptions = {}): Promise<AdminMediaListResult> {
  const supabase = createServiceRoleSupabaseClient();
  const pageSize = clampInteger(options.pageSize ?? 24, 12, 60);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("media_assets")
    .select("id, file_name, mime_type, bucket, storage_path, public_url, alt, caption, featured, created_at, size_bytes, posts!media_assets_post_id_fkey(id, title, slug)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (options.featuredOnly) query = query.eq("featured", true);
  if (options.featured === "featured") query = query.eq("featured", true);
  if (options.featured === "normal") query = query.eq("featured", false);
  if (options.visibility === "public") query = query.eq("bucket", supabaseEnv.publicBucket);
  if (options.visibility === "private") query = query.eq("bucket", supabaseEnv.privateBucket);
  if (options.relation === "linked") query = query.not("post_id", "is", null);
  if (options.relation === "unlinked") query = query.is("post_id", null);

  if (options.type === "image") query = query.ilike("mime_type", "image/%");
  if (options.type === "audio") query = query.ilike("mime_type", "audio/%");
  if (options.type === "video") query = query.ilike("mime_type", "video/%");
  if (options.type === "other") {
    query = query
      .not("mime_type", "ilike", "image/%")
      .not("mime_type", "ilike", "audio/%")
      .not("mime_type", "ilike", "video/%");
  }

  const search = options.query?.trim();
  if (search) {
    const escaped = escapeIlikePattern(search);
    query = query.or([
      `file_name.ilike.%${escaped}%`,
      `storage_path.ilike.%${escaped}%`,
      `alt.ilike.%${escaped}%`,
      `caption.ilike.%${escaped}%`,
    ].join(","));
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;
  const assets = await Promise.all(((data ?? []) as AdminMediaAsset[]).map(async (asset) => ({
    ...asset,
    display_url: asset.bucket === supabaseEnv.privateBucket ? await createPrivateMediaSignedUrl(asset.storage_path, supabase) : asset.public_url,
  })));

  const total = count ?? 0;
  return {
    assets,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listAdminImageMedia(options: { limit?: number } = {}) {
  const assets = await listAdminMedia();
  const images = assets.filter((asset) => asset.mime_type.startsWith("image/"));
  return options.limit ? images.slice(0, options.limit) : images;
}

export async function uploadAdminMedia(input: UploadAdminMediaInput) {
  validateUploadImage(input.file);
  const supabase = createServiceRoleSupabaseClient();
  const bucket = resolveBucketForPostVisibility(input.visibility);
  const storagePath = await buildUploadPath(input.file);
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: input.file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
  const record = {
    uploader_id: input.uploaderId,
    post_id: input.postId || null,
    file_name: input.file.name,
    mime_type: input.file.type,
    bucket,
    storage_path: storagePath,
    public_url: publicUrl,
    alt: input.alt?.trim() || stripExtension(input.file.name),
    caption: input.caption?.trim() || null,
    featured: input.featured ?? false,
    size_bytes: input.file.size,
  };

  const { data, error } = await supabase
    .from("media_assets")
    .insert(record)
    .select("id, file_name, mime_type, bucket, storage_path, public_url, alt, caption, featured, created_at, size_bytes, posts!media_assets_post_id_fkey(id, title, slug)")
    .single();

  if (error) {
    await supabase.storage.from(bucket).remove([storagePath]);
    throw error;
  }

  const asset = data as AdminMediaAsset;
  return {
    ...asset,
    display_url: asset.bucket === supabaseEnv.privateBucket ? await createPrivateMediaSignedUrl(asset.storage_path, supabase) : asset.public_url,
  };
}

export async function toggleMediaFeatured(id: string, featured: boolean) {
  const { error } = await createServiceRoleSupabaseClient().from("media_assets").update({ featured }).eq("id", id);
  if (error) throw error;
}

export async function updateMediaMeta(id: string, input: { alt?: string; caption?: string }) {
  const { error } = await createServiceRoleSupabaseClient()
    .from("media_assets")
    .update({
      alt: input.alt?.trim() || null,
      caption: input.caption?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAdminMediaAssets(ids: string[]) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error("请选择要删除的媒体");

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("media_assets")
    .select("id, bucket, storage_path")
    .in("id", uniqueIds);
  if (error) throw error;

  const assets = data ?? [];
  if (assets.length === 0) throw new Error("没有找到可删除的媒体");

  for (const asset of assets) {
    const { error: storageError } = await supabase.storage.from(asset.bucket).remove([asset.storage_path]);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await supabase.from("media_assets").delete().in("id", assets.map((asset) => asset.id));
  if (deleteError) throw deleteError;
}

export function resolveBucketForPostVisibility(visibility: AdminPostVisibility) {
  return visibility === "private" ? supabaseEnv.privateBucket : supabaseEnv.publicBucket;
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

export async function saveAdminPost(input: SaveAdminPostInput, authorId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const existing = input.id ? await getAdminPostById(input.id) : null;
  if (input.intent === "publish" && !input.title.trim()) throw new Error("发布前需要填写标题");
  const title = input.title.trim() || "未命名草稿";
  const requestedSlug = input.slug?.trim() || title;
  const slug = await ensureUniquePostSlug(requestedSlug, existing?.id);
  const categoryId = await resolveCategoryId(input.categoryId, input.newCategoryName);
  const status = resolvePostStatus(input.intent);
  const publishedAt = resolvePublishedAt(status, input.publishedAt, existing?.published_at);
  const payload = {
    title,
    slug,
    excerpt: input.excerpt?.trim() || null,
    markdown: input.markdown ?? "",
    cover_url: input.coverUrl?.trim() || null,
    cover_asset_id: input.coverAssetId || null,
    category_id: categoryId,
    status,
    visibility: input.visibility,
    noindex: input.noindex,
    published_at: publishedAt,
    html: null,
  };

  let postId = existing?.id;

  if (postId) {
    const { error } = await supabase.from("posts").update(payload).eq("id", postId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("posts")
      .insert({ ...payload, author_id: authorId })
      .select("id")
      .single();
    if (error) throw error;
    postId = data.id;
  }

  if (!postId) throw new Error("文章保存失败");
  const tagIds = await ensureTags(input.tagNames ?? []);
  await syncPostTags(postId, tagIds);
  return postId;
}

export async function ensureTags(names: string[]) {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (uniqueNames.length === 0) return [];

  const supabase = createServiceRoleSupabaseClient();
  const { data: existingTags, error } = await supabase.from("tags").select("id, name, slug").in("name", uniqueNames);
  if (error) throw error;

  const tagsByName = new Map((existingTags ?? []).map((tag) => [tag.name, tag.id]));
  const missingNames = uniqueNames.filter((name) => !tagsByName.has(name));

  for (const name of missingNames) {
    const { data, error: insertError } = await supabase
      .from("tags")
      .insert({ name, slug: await ensureUniqueTagSlug(name) })
      .select("id")
      .single();

    if (insertError) throw insertError;
    tagsByName.set(name, data.id);
  }

  return uniqueNames.map((name) => tagsByName.get(name)).filter(Boolean) as string[];
}

export async function syncPostTags(postId: string, tagIds: string[]) {
  const supabase = createServiceRoleSupabaseClient();
  const { error: deleteError } = await supabase.from("post_tags").delete().eq("post_id", postId);
  if (deleteError) throw deleteError;
  if (tagIds.length === 0) return;

  const { error } = await supabase
    .from("post_tags")
    .insert(tagIds.map((tagId) => ({ post_id: postId, tag_id: tagId })));
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

async function resolveCategoryId(categoryId?: string, newCategoryName?: string) {
  const categoryName = newCategoryName?.trim();
  if (categoryName) {
    const slug = await ensureUniqueCategorySlug(categoryName);
    const { data, error } = await createServiceRoleSupabaseClient()
      .from("categories")
      .insert({ name: categoryName, slug, sort_order: 0, visible: true })
      .select("id")
      .single();

    if (error) throw error;
    return data.id as string;
  }

  if (categoryId) return categoryId;

  const { data, error } = await createServiceRoleSupabaseClient()
    .from("categories")
    .select("id")
    .eq("name", "未分类")
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function ensureUniquePostSlug(value: string, postId?: string) {
  return ensureUniqueSlug("posts", value, postId);
}

async function ensureUniqueTagSlug(value: string) {
  return ensureUniqueSlug("tags", value);
}

async function ensureUniqueCategorySlug(value: string) {
  return ensureUniqueSlug("categories", value);
}

async function ensureUniqueSlug(table: "posts" | "tags" | "categories", value: string, excludeId?: string) {
  const baseSlug = safeSlug(value);
  const supabase = createServiceRoleSupabaseClient();

  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    let query = supabase.from(table).select("id").eq("slug", slug).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) return slug;
  }

  return `${baseSlug}-${Date.now().toString(36)}`;
}

function safeSlug(value: string) {
  try {
    return normalizeSlug(value);
  } catch {
    return `post-${Date.now().toString(36)}`;
  }
}

function resolvePostStatus(intent: SaveAdminPostInput["intent"]) {
  if (intent === "publish") return "published";
  if (intent === "archive") return "archived";
  return "draft";
}

function resolvePublishedAt(status: AdminPostStatus, value: string | undefined, currentValue: string | null | undefined) {
  if (status !== "published") return currentValue ?? null;
  if (value) return new Date(value).toISOString();
  return currentValue ?? new Date().toISOString();
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

async function buildUploadPath(file: File) {
  const hash = await hashFile(file);
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `uploads/${year}/${month}/${hash}-${safeFileName(file.name)}`;
}

async function hashFile(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFileName(name: string) {
  const normalized = name.normalize("NFKC").trim();
  const dotIndex = normalized.lastIndexOf(".");
  const ext = dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const stem = stripExtension(normalized)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "media";
  return `${stem}${ext}`;
}

function stripExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

function validateUploadImage(file: File) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowedTypes.has(file.type)) throw new Error("只支持上传 JPG、PNG、WebP 或 GIF 图片");
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB");
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function createPrivateMediaSignedUrl(storagePath: string, supabase: ReturnType<typeof createServiceRoleSupabaseClient>) {
  const { data, error } = await supabase.storage.from(supabaseEnv.privateBucket).createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
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
