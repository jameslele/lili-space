import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import type { CurrentUser } from "./auth";
import { isAdmin } from "./auth";
import { createServiceRoleSupabaseClient } from "./supabase/server";

type Viewer = CurrentUser | null | undefined;

export type PostStatus = "draft" | "published" | "archived";
export type PostVisibility = "public" | "private";

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  visible: boolean;
  postCount?: number;
}

export interface TagSummary {
  id: string;
  name: string;
  slug: string;
  postCount?: number;
}

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_url: string | null;
  status: PostStatus;
  visibility: PostVisibility;
  noindex: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  category: CategorySummary | null;
  tags: TagSummary[];
}

export interface PostDetail extends PostSummary {
  markdown: string;
  html: string | null;
  renderedHtml: string;
}

export interface ArchiveGroup {
  year: string;
  posts: PostSummary[];
}

export interface GalleryAsset {
  id: string;
  file_name: string;
  public_url: string;
  alt: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  bucket: string;
  storage_path: string;
  featured: boolean;
  sort_order: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type RawPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  markdown?: string;
  html?: string | null;
  cover_url: string | null;
  status: PostStatus;
  visibility: PostVisibility;
  noindex: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  categories: CategorySummary | CategorySummary[] | null;
};

const postSelect = `
  id,
  title,
  slug,
  excerpt,
  cover_url,
  status,
  visibility,
  noindex,
  published_at,
  created_at,
  updated_at,
  categories (
    id,
    name,
    slug,
    description,
    sort_order,
    visible
  )
`;

const postDetailSelect = `
  ${postSelect},
  markdown,
  html
`;

export function canViewAllPosts(user: CurrentUser | null | undefined) {
  return isAdmin(user);
}

export function canViewPost(post: Pick<PostSummary, "status" | "visibility">, viewer: Viewer) {
  return canViewAllPosts(viewer) || isPublicPublishedPost(post);
}

export function isPublicPublishedPost(post: Pick<PostSummary, "status" | "visibility">) {
  return post.status === "published" && post.visibility === "public";
}

export function isHiddenFromHome(post: Pick<PostSummary, "noindex">, viewer: Viewer) {
  return !canViewAllPosts(viewer) && post.noindex;
}

export async function getPostsForViewer(viewer: Viewer, options: { limit?: number; includeNoindex?: boolean } = {}) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase.from("posts").select(postSelect).order("published_at", { ascending: false, nullsFirst: false });

  if (!canViewAllPosts(viewer)) {
    query = query.eq("status", "published").eq("visibility", "public");
    if (!options.includeNoindex) query = query.eq("noindex", false);
  }

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  return attachTags((data ?? []) as RawPost[]);
}

export async function getPostsPageForViewer(
  viewer: Viewer,
  options: { page?: number; pageSize?: number; includeNoindex?: boolean } = {},
): Promise<PaginatedResult<PostSummary>> {
  const pageSize = clampInteger(options.pageSize ?? 12, 6, 30);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase
    .from("posts")
    .select(postSelect, { count: "exact" })
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (!canViewAllPosts(viewer)) {
    query = query.eq("status", "published").eq("visibility", "public");
    if (!options.includeNoindex) query = query.eq("noindex", false);
  }

  const { data, error, count } = await query;
  if (error) {
    if (isRangeNotSatisfiableError(error)) {
      const total = await countPostsForViewer(viewer, options);
      return {
        items: [],
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
    throw error;
  }

  const total = count ?? 0;
  return {
    items: await attachTags((data ?? []) as RawPost[]),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getPostBySlugForViewer(slug: string, viewer: Viewer) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("posts").select(postDetailSelect).eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [post] = await attachTags([data as RawPost]);
  if (!post || !canViewPost(post, viewer)) return null;

  const rawHtml = (data as RawPost).html || await marked.parse((data as RawPost).markdown ?? "");
  const renderedHtml = await signPrivateMediaUrls(sanitizeRenderedHtml(rawHtml), viewer);
  return {
    ...post,
    markdown: (data as RawPost).markdown ?? "",
    html: (data as RawPost).html ?? null,
    renderedHtml,
  } satisfies PostDetail;
}

export async function getCategoriesWithCounts(viewer: Viewer) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
  if (error) throw error;

  const posts = await getPostsForViewer(viewer, { includeNoindex: true });
  const counts = countBy(posts.map((post) => post.category?.id).filter(Boolean) as string[]);
  const categories = (data ?? []).filter((category) => category.visible);

  return (categories as CategorySummary[]).map((category) => ({
    ...category,
    postCount: counts.get(category.id) ?? 0,
  }));
}

export async function getCategoryPage(slug: string, viewer: Viewer) {
  const categories = await getCategoriesWithCounts(viewer);
  const category = categories.find((item) => item.slug === slug);
  if (!category) return null;

  const posts = (await getPostsForViewer(viewer, { includeNoindex: true })).filter((post) => post.category?.id === category.id);
  return { category, posts, archive: groupPostsByYear(posts) };
}

export async function getTagsWithCounts(viewer: Viewer) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("tags").select("*").order("name", { ascending: true });
  if (error) throw error;

  const posts = await getPostsForViewer(viewer, { includeNoindex: true });
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
  }

  return ((data ?? []) as TagSummary[]).map((tag) => ({ ...tag, postCount: counts.get(tag.id) ?? 0 }));
}

export async function getTagPage(slug: string, viewer: Viewer) {
  const tags = await getTagsWithCounts(viewer);
  const tag = tags.find((item) => item.slug === slug);
  if (!tag) return null;

  const posts = (await getPostsForViewer(viewer, { includeNoindex: true })).filter((post) => post.tags.some((item) => item.id === tag.id));
  return { tag, posts, archive: groupPostsByYear(posts) };
}

export async function getArchiveGroups(viewer: Viewer) {
  return groupPostsByYear(await getPostsForViewer(viewer, { includeNoindex: true }));
}

export async function getFeaturedGalleryAssets(viewer: Viewer) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase
    .from("media_assets")
    .select("id, file_name, public_url, alt, caption, width, height, created_at, bucket, storage_path, featured, sort_order")
    .eq("featured", true)
    .ilike("mime_type", "image/%")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (!canViewAllPosts(viewer)) query = query.eq("bucket", "public-media");

  const { data, error } = await query;
  if (error) throw error;

  const assets = data ?? [];
  if (!canViewAllPosts(viewer)) return assets as GalleryAsset[];

  return Promise.all(assets.map(async (asset) => ({
    ...asset,
    public_url: asset.bucket === "private-media" ? await createPrivateMediaSignedUrl(asset.storage_path, supabase) : asset.public_url,
  }))) as Promise<GalleryAsset[]>;
}

export async function getFeaturedGalleryAssetsPage(
  viewer: Viewer,
  options: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<GalleryAsset>> {
  const pageSize = clampInteger(options.pageSize ?? 24, 12, 48);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase
    .from("media_assets")
    .select("id, file_name, public_url, alt, caption, width, height, created_at, bucket, storage_path, featured, sort_order", { count: "exact" })
    .eq("featured", true)
    .ilike("mime_type", "image/%")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (!canViewAllPosts(viewer)) query = query.eq("bucket", "public-media");

  const { data, error, count } = await query;
  if (error) {
    if (isRangeNotSatisfiableError(error)) {
      const total = await countFeaturedGalleryAssets(viewer);
      return {
        items: [],
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
    throw error;
  }

  const assets = data ?? [];
  const items = canViewAllPosts(viewer)
    ? await Promise.all(assets.map(async (asset) => ({
      ...asset,
      public_url: asset.bucket === "private-media" ? await createPrivateMediaSignedUrl(asset.storage_path, supabase) : asset.public_url,
    }))) as GalleryAsset[]
    : assets as GalleryAsset[];

  const total = count ?? 0;
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function groupPostsByYear(posts: PostSummary[]): ArchiveGroup[] {
  const groups = new Map<string, PostSummary[]>();
  for (const post of posts) {
    const date = post.published_at ?? post.created_at;
    const year = new Date(date).getFullYear().toString();
    const group = groups.get(year) ?? [];
    group.push(post);
    groups.set(year, group);
  }
  return Array.from(groups.entries()).map(([year, groupPosts]) => ({ year, posts: groupPosts }));
}

export function formatPostDate(post: Pick<PostSummary, "published_at" | "created_at">, options: Intl.DateTimeFormatOptions = {}) {
  const date = new Date(post.published_at ?? post.created_at);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  }).format(date);
}

export function getPostExcerpt(post: Pick<PostSummary, "excerpt" | "title">) {
  return post.excerpt || `${post.title}。`;
}

async function attachTags(rawPosts: RawPost[]) {
  const ids = rawPosts.map((post) => post.id);
  if (ids.length === 0) return [];

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("post_tags").select("post_id, tags(id, name, slug)").in("post_id", ids);
  if (error) throw error;

  const tagMap = new Map<string, TagSummary[]>();
  for (const row of data ?? []) {
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tag) continue;
    const tags = tagMap.get(row.post_id) ?? [];
    tags.push(tag as TagSummary);
    tagMap.set(row.post_id, tags);
  }

  return rawPosts.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    cover_url: post.cover_url,
    status: post.status,
    visibility: post.visibility,
    noindex: post.noindex,
    published_at: post.published_at,
    created_at: post.created_at,
    updated_at: post.updated_at,
    category: normalizeCategory(post.categories),
    tags: tagMap.get(post.id) ?? [],
  }));
}

function normalizeCategory(category: RawPost["categories"]) {
  if (Array.isArray(category)) return category[0] ?? null;
  return category;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isRangeNotSatisfiableError(error: { code?: string }) {
  return error.code === "PGRST103";
}

async function countPostsForViewer(viewer: Viewer, options: { includeNoindex?: boolean }) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase.from("posts").select("id", { count: "exact", head: true });

  if (!canViewAllPosts(viewer)) {
    query = query.eq("status", "published").eq("visibility", "public");
    if (!options.includeNoindex) query = query.eq("noindex", false);
  }

  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function countFeaturedGalleryAssets(viewer: Viewer) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("featured", true)
    .ilike("mime_type", "image/%");

  if (!canViewAllPosts(viewer)) query = query.eq("bucket", "public-media");

  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}

function sanitizeRenderedHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "video", "audio", "source", "iframe"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      video: ["src", "controls", "height", "width", "poster", "preload"],
      audio: ["src", "controls", "preload"],
      source: ["src", "type"],
      iframe: ["src", "frameborder", "border", "marginwidth", "marginheight", "width", "height", "allow", "allowfullscreen"],
      code: ["class"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }, true),
      video: sanitizeHtml.simpleTransform("video", { controls: "" }, true),
      audio: sanitizeHtml.simpleTransform("audio", { controls: "" }, true),
    },
  });
}

async function signPrivateMediaUrls(html: string, viewer: Viewer) {
  if (!canViewAllPosts(viewer) || !html.includes("/private-media/")) return html;

  const supabase = createServiceRoleSupabaseClient();
  const matches = [...html.matchAll(/https:\/\/[^"'\s<>]+\/storage\/v1\/object\/public\/private-media\/([^"'\s<>]+)/g)];
  if (matches.length === 0) return html;

  let signedHtml = html;
  for (const match of matches) {
    const originalUrl = match[0];
    const storagePath = decodeURIComponent(match[1]);
    try {
      const signedUrl = await createPrivateMediaSignedUrl(storagePath, supabase);
      signedHtml = signedHtml.split(originalUrl).join(signedUrl);
    } catch {
      // Keep the original private URL if the object no longer exists or signing fails.
    }
  }
  return signedHtml;
}

async function createPrivateMediaSignedUrl(storagePath: string, supabase: ReturnType<typeof createServiceRoleSupabaseClient>) {
  const { data, error } = await supabase.storage.from("private-media").createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
