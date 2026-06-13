import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import type { CurrentUser } from "./auth";
import { isAdmin } from "./auth";
import { createServiceRoleSupabaseClient } from "./supabase/server";

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

export function canViewPost(post: Pick<PostSummary, "status" | "visibility">, user: CurrentUser | null | undefined) {
  return canViewAllPosts(user) || (post.status === "published" && post.visibility === "public");
}

export async function getPostsForViewer(user: CurrentUser | null | undefined, options: { limit?: number; includeNoindex?: boolean } = {}) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase.from("posts").select(postSelect).order("published_at", { ascending: false, nullsFirst: false });

  if (!canViewAllPosts(user)) {
    query = query.eq("status", "published").eq("visibility", "public");
    if (!options.includeNoindex) query = query.eq("noindex", false);
  }

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  return attachTags((data ?? []) as RawPost[]);
}

export async function getPostBySlugForViewer(slug: string, user: CurrentUser | null | undefined) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("posts").select(postDetailSelect).eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [post] = await attachTags([data as RawPost]);
  if (!post || !canViewPost(post, user)) return null;

  const rawHtml = (data as RawPost).html || await marked.parse((data as RawPost).markdown ?? "");
  return {
    ...post,
    markdown: (data as RawPost).markdown ?? "",
    html: (data as RawPost).html ?? null,
    renderedHtml: sanitizeRenderedHtml(rawHtml),
  } satisfies PostDetail;
}

export async function getCategoriesWithCounts(user: CurrentUser | null | undefined) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
  if (error) throw error;

  const posts = await getPostsForViewer(user, { includeNoindex: true });
  const counts = countBy(posts.map((post) => post.category?.id).filter(Boolean) as string[]);

  return ((data ?? []) as CategorySummary[]).map((category) => ({
    ...category,
    postCount: counts.get(category.id) ?? 0,
  }));
}

export async function getCategoryPage(slug: string, user: CurrentUser | null | undefined) {
  const categories = await getCategoriesWithCounts(user);
  const category = categories.find((item) => item.slug === slug);
  if (!category) return null;

  const posts = (await getPostsForViewer(user, { includeNoindex: true })).filter((post) => post.category?.id === category.id);
  return { category, posts, archive: groupPostsByYear(posts) };
}

export async function getTagsWithCounts(user: CurrentUser | null | undefined) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.from("tags").select("*").order("name", { ascending: true });
  if (error) throw error;

  const posts = await getPostsForViewer(user, { includeNoindex: true });
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
  }

  return ((data ?? []) as TagSummary[]).map((tag) => ({ ...tag, postCount: counts.get(tag.id) ?? 0 }));
}

export async function getTagPage(slug: string, user: CurrentUser | null | undefined) {
  const tags = await getTagsWithCounts(user);
  const tag = tags.find((item) => item.slug === slug);
  if (!tag) return null;

  const posts = (await getPostsForViewer(user, { includeNoindex: true })).filter((post) => post.tags.some((item) => item.id === tag.id));
  return { tag, posts, archive: groupPostsByYear(posts) };
}

export async function getArchiveGroups(user: CurrentUser | null | undefined) {
  return groupPostsByYear(await getPostsForViewer(user, { includeNoindex: true }));
}

export async function getFeaturedGalleryAssets(user: CurrentUser | null | undefined) {
  const supabase = createServiceRoleSupabaseClient();
  let query = supabase
    .from("media_assets")
    .select("id, file_name, public_url, alt, caption, width, height, created_at, bucket, featured")
    .eq("featured", true)
    .order("created_at", { ascending: false });

  if (!canViewAllPosts(user)) query = query.eq("bucket", "public-media");

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as GalleryAsset[];
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
