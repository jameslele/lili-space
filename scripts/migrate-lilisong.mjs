import { createClient } from "@supabase/supabase-js";
import matter from "gray-matter";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname;
const postsDir = join(projectRoot, "lilisong/source/_posts");
const reportsDir = join(projectRoot, "migration-reports");
const dryRun = !process.argv.includes("--execute");
const writePreview = process.argv.includes("--write-preview") || dryRun;

loadEnv(join(projectRoot, ".env"));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const parsedPosts = parseLegacyPosts();
const mediaRefs = parsedPosts.flatMap((post) => post.mediaRefs);
const categoryNames = unique(parsedPosts.map((post) => post.primaryCategory));
const tagNames = unique(parsedPosts.flatMap((post) => post.tags));

const summary = {
  mode: dryRun ? "dry-run" : "execute",
  sourcePosts: parsedPosts.length,
  categories: categoryNames.length,
  tags: tagNames.length,
  mediaRefs: mediaRefs.length,
  postsWithCover: parsedPosts.filter((post) => post.coverUrl).length,
  noindexPosts: parsedPosts.filter((post) => post.noindex).length,
  results: [],
  failures: [],
};

console.log(`[lilisong] mode=${summary.mode}`);
console.log(`[lilisong] posts=${summary.sourcePosts}, categories=${summary.categories}, tags=${summary.tags}, mediaRefs=${summary.mediaRefs}`);

const { data: admin, error: adminError } = await supabase
  .from("users")
  .select("id, username, role")
  .eq("username", "root")
  .single();
if (adminError) throw adminError;
if (admin.role !== "admin") throw new Error("root user exists but is not admin.");

const { data: existingCategories, error: categoryReadError } = await supabase
  .from("categories")
  .select("id, name, slug, sort_order")
  .order("sort_order", { ascending: true });
if (categoryReadError) throw categoryReadError;

const { data: existingTags, error: tagReadError } = await supabase.from("tags").select("id, name, slug");
if (tagReadError) throw tagReadError;

const categoryMap = new Map((existingCategories ?? []).map((category) => [category.name, category]));
const tagMap = new Map((existingTags ?? []).map((tag) => [tag.name, tag]));
const allCategorySlugs = new Set((existingCategories ?? []).map((category) => category.slug));
const allTagSlugs = new Set((existingTags ?? []).map((tag) => tag.slug));
let nextSortOrder = Math.max(0, ...(existingCategories ?? []).map((category) => Number(category.sort_order) || 0)) + 10;

for (const name of categoryNames) {
  if (categoryMap.has(name)) continue;
  const category = {
    name,
    slug: uniqueSlug(toSlug(name), allCategorySlugs),
    sort_order: nextSortOrder,
    visible: true,
  };
  nextSortOrder += 10;

  if (!dryRun) {
    const { data, error } = await supabase.from("categories").insert(category).select("id, name, slug, sort_order").single();
    if (error) throw error;
    categoryMap.set(name, data);
  } else {
    categoryMap.set(name, { ...category, id: `dry-category-${category.slug}` });
  }
}

for (const name of tagNames) {
  if (tagMap.has(name)) continue;
  const tag = { name, slug: uniqueSlug(toSlug(name), allTagSlugs) };
  if (!dryRun) {
    const { data, error } = await supabase.from("tags").insert(tag).select("id, name, slug").single();
    if (error) throw error;
    tagMap.set(name, data);
  } else {
    tagMap.set(name, { ...tag, id: `dry-tag-${tag.slug}` });
  }
}

const { data: existingPosts, error: postReadError } = await supabase.from("posts").select("id, slug");
if (postReadError) throw postReadError;
const postMap = new Map((existingPosts ?? []).map((post) => [post.slug, post]));

for (const legacyPost of parsedPosts) {
  try {
    const category = categoryMap.get(legacyPost.primaryCategory);
    if (!category) throw new Error(`Missing category: ${legacyPost.primaryCategory}`);

    const postPayload = {
      author_id: admin.id,
      category_id: category.id,
      title: legacyPost.title,
      slug: legacyPost.slug,
      excerpt: legacyPost.excerpt,
      markdown: legacyPost.markdown,
      html: null,
      cover_url: legacyPost.coverUrl,
      status: "published",
      visibility: "public",
      noindex: legacyPost.noindex,
      published_at: legacyPost.publishedAt,
    };

    const existingPost = postMap.get(legacyPost.slug);
    let postId = existingPost?.id;
    const status = existingPost ? "updated" : "created";

    if (!dryRun) {
      const { data, error } = await supabase
        .from("posts")
        .upsert(postPayload, { onConflict: "slug" })
        .select("id")
        .single();
      if (error) throw error;
      postId = data.id;

      const { error: deleteError } = await supabase.from("post_tags").delete().eq("post_id", postId);
      if (deleteError) throw deleteError;

      const tagRows = legacyPost.tags
        .map((name) => tagMap.get(name))
        .filter(Boolean)
        .map((tag) => ({ post_id: postId, tag_id: tag.id }));
      if (tagRows.length > 0) {
        const { error: tagError } = await supabase.from("post_tags").insert(tagRows);
        if (tagError) throw tagError;
      }
    }

    const line = {
      status,
      title: legacyPost.title,
      slug: legacyPost.slug,
      file: legacyPost.file,
      category: legacyPost.primaryCategory,
      tags: legacyPost.tags,
      abbrlink: legacyPost.abbrlink,
      mediaRefs: legacyPost.mediaRefs.length,
    };
    summary.results.push(line);
    console.log(`${status.padEnd(7)} ${legacyPost.slug}  ${legacyPost.title}`);
  } catch (error) {
    const failed = {
      status: "failed",
      title: legacyPost.title,
      slug: legacyPost.slug,
      file: legacyPost.file,
      error: error instanceof Error ? error.message : String(error),
    };
    summary.failures.push(failed);
    console.error(`failed  ${legacyPost.slug}  ${failed.error}`);
  }
}

mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, "lilisong-media-refs.json"), `${JSON.stringify(mediaRefs, null, 2)}\n`);
if (writePreview) {
  writeFileSync(
    join(reportsDir, "lilisong-posts-preview.json"),
    `${JSON.stringify(parsedPosts.map(toPreviewPost), null, 2)}\n`,
  );
}
writeFileSync(join(reportsDir, "lilisong-migration-summary.md"), renderSummary(summary, categoryNames, tagNames));

console.log(`[lilisong] ${summary.mode} complete: created=${countStatus("created")}, updated=${countStatus("updated")}, failed=${summary.failures.length}`);
console.log("[lilisong] reports written to migration-reports/");

function parseLegacyPosts() {
  const files = readdirSync(postsDir).filter((file) => file.endsWith(".md")).sort();
  const usedSlugs = new Set();

  return files.map((file) => {
    const fullPath = join(postsDir, file);
    const raw = readFileSync(fullPath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    const filename = basename(file, ".md");
    const abbrlink = data.abbrlink == null ? null : String(data.abbrlink);
    const baseSlug = toSlug(filename) || (abbrlink ? `abbrlink-${abbrlink}` : toSlug(String(data.title ?? filename)));
    const slug = uniqueSlug(baseSlug, usedSlugs, abbrlink);
    const categories = toArray(data.categories);
    const extraCategories = categories.slice(1);
    const primaryCategory = categories[0] || "未分类";
    const tags = unique([...toArray(data.tags), ...extraCategories]);
    const title = String(data.title || filename);
    const coverUrl = normalizeUrl(data.cover == null ? "" : String(data.cover).trim());
    const markdown = parsed.content.trim();
    const publishedAt = toIsoDate(data.date);
    const bodyMediaRefs = extractMediaRefs(markdown, { title, slug, file });
    const coverRef = coverUrl
      ? [createMediaRef({ title, slug, file, url: coverUrl, type: mediaTypeFromUrl(coverUrl, "cover"), isCover: true })]
      : [];

    return {
      file,
      title,
      slug,
      abbrlink,
      oldPermalink: publishedAt ? legacyPermalink(publishedAt, filename) : null,
      primaryCategory,
      extraCategories,
      tags,
      coverUrl: coverUrl || null,
      excerpt: data.excerpt == null ? null : String(data.excerpt),
      publishedAt,
      noindex: Boolean(data.noindex),
      markdown,
      mediaRefs: [...coverRef, ...bodyMediaRefs],
    };
  });
}

function extractMediaRefs(markdown, post) {
  const refs = [];
  const markdownImageRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(markdownImageRe)) {
    refs.push(createMediaRef({ ...post, url: normalizeUrl(match[1]), type: mediaTypeFromUrl(match[1], "image"), isCover: false }));
  }

  const htmlMediaRe = /<(img|video|audio|source|iframe)\b[^>]*\bsrc=["']?([^"'\s>]+)[^>]*>/gi;
  for (const match of markdown.matchAll(htmlMediaRe)) {
    refs.push(createMediaRef({ ...post, url: normalizeUrl(match[2]), type: mediaTypeFromTag(match[1], match[2]), isCover: false }));
  }

  return refs;
}

function createMediaRef({ title, slug, file, url, type, isCover }) {
  return {
    title,
    slug,
    file,
    url,
    type,
    isCover,
    likelyLilisongOss: /lilisong(?:-assets)?\.oss-cn-hangzhou\.aliyuncs\.com/.test(url),
    needsMigration: /^https?:\/\//.test(url) || url.startsWith("//"),
  };
}

function toPreviewPost(post) {
  return {
    file: post.file,
    title: post.title,
    slug: post.slug,
    abbrlink: post.abbrlink,
    oldPermalink: post.oldPermalink,
    category: post.primaryCategory,
    extraCategories: post.extraCategories,
    tags: post.tags,
    coverUrl: post.coverUrl,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt,
    noindex: post.noindex,
    mediaRefs: post.mediaRefs.length,
  };
}

function renderSummary(data, categories, tags) {
  const lines = [
    "# lilisong 内容迁移汇总",
    "",
    `- 模式：${data.mode}`,
    `- 旧文章数量：${data.sourcePosts}`,
    `- 分类数量：${data.categories}`,
    `- 标签数量：${data.tags}`,
    `- 媒体引用数量：${data.mediaRefs}`,
    `- 带封面文章：${data.postsWithCover}`,
    `- noindex 文章：${data.noindexPosts}`,
    `- created：${data.results.filter((item) => item.status === "created").length}`,
    `- updated：${data.results.filter((item) => item.status === "updated").length}`,
    `- failed：${data.failures.length}`,
    "",
    "## 分类",
    "",
    ...categories.map((name) => `- ${name}`),
    "",
    "## 标签",
    "",
    ...(tags.length ? tags.map((name) => `- ${name}`) : ["- 无"]),
    "",
    "## 文章结果",
    "",
    ...data.results.map((item) => `- ${item.status}: ${item.title} (${item.slug})`),
  ];

  if (data.failures.length > 0) {
    lines.push("", "## 失败", "", ...data.failures.map((item) => `- ${item.title} (${item.slug}): ${item.error}`));
  }

  return `${lines.join("\n")}\n`;
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

function toArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toSlug(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(baseSlug, usedSlugs, fallback) {
  let slug = baseSlug || (fallback ? `abbrlink-${fallback}` : "post");
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }

  const suffix = fallback ? String(fallback) : shortHash(slug);
  slug = `${slug}-${suffix}`;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}-${counter}`;
    counter += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function normalizeUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

function mediaTypeFromTag(tag, url) {
  const lowerTag = tag.toLowerCase();
  if (lowerTag === "img") return "image";
  if (lowerTag === "iframe") return "iframe";
  if (lowerTag === "source") return mediaTypeFromUrl(url, "source");
  return lowerTag;
}

function mediaTypeFromUrl(url, fallback) {
  const cleanUrl = String(url).split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(cleanUrl)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/.test(cleanUrl)) return "video";
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(cleanUrl)) return "audio";
  return fallback;
}

function legacyPermalink(publishedAt, filename) {
  const date = new Date(publishedAt);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `/${yyyy}/${mm}/${dd}/${filename}/`;
}

function countStatus(status) {
  return summary.results.filter((item) => item.status === status).length;
}
