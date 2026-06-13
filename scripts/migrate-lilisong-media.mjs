import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import tus from "tus-js-client";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname;
const reportsDir = join(projectRoot, "migration-reports");
const refsPath = join(reportsDir, "lilisong-media-refs.json");
const cacheDir = join(projectRoot, ".migration-cache/lilisong-media");
const backupsDir = join(reportsDir, "backups");

const args = parseArgs(process.argv.slice(2));
const dryRun = !args.execute;
const limit = args.limit ? Number(args.limit) : null;
const now = new Date();
const timestamp = formatTimestamp(now);

loadEnv(join(projectRoot, ".env"));

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
if (args.skipUpload && !args.skipDbUpdate) {
  throw new Error("--skip-upload must be used with --skip-db-update to avoid writing unuploaded media URLs.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const storageUploadEndpoint = buildStorageUploadEndpoint(supabaseUrl);

if (!existsSync(refsPath)) throw new Error(`Missing media refs file: ${refsPath}`);
const refs = JSON.parse(readFileSync(refsPath, "utf8"));
const filteredRefs = refs.filter((ref) => {
  if (!ref.needsMigration || ref.type === "iframe") return false;
  if (args.onlyImages) return ref.type === "image";
  if (args.onlyVideos) return ref.type === "video";
  return true;
});
const uniqueRefs = dedupeByUrl(filteredRefs);
const skippedRefs = refs.filter((ref) => {
  if (ref.type === "iframe" || !ref.needsMigration) return true;
  if (args.onlyImages) return ref.type !== "image";
  if (args.onlyVideos) return ref.type !== "video";
  return false;
});
const selectedRefs = limit ? uniqueRefs.slice(0, limit) : uniqueRefs;

const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
if (bucketsError) throw bucketsError;
const bucketState = Object.fromEntries(buckets.map((bucket) => [bucket.name, bucket.public]));
if (bucketState["public-media"] !== true) throw new Error("public-media bucket is missing or not public.");
if (bucketState["private-media"] !== false) throw new Error("private-media bucket is missing or public.");

const { data: admin, error: adminError } = await supabase.from("users").select("id").eq("username", "root").single();
if (adminError) throw adminError;

const { data: posts, error: postsError } = await supabase
  .from("posts")
  .select("id, slug, title, markdown, cover_url, status, visibility, published_at, created_at")
  .order("published_at", { ascending: false });
if (postsError) throw postsError;
const postsBySlug = new Map(posts.map((post) => [post.slug, post]));

const { data: existingMedia, error: mediaError } = await supabase
  .from("media_assets")
  .select("id, bucket, storage_path, public_url, file_name, mime_type, size_bytes");
if (mediaError) throw mediaError;
const mediaByPath = new Map((existingMedia ?? []).map((asset) => [`${asset.bucket}/${asset.storage_path}`, asset]));

const previousFailures = args.retryFailed ? readPreviousFailures() : null;
const workRefs = previousFailures
  ? selectedRefs.filter((ref) => previousFailures.has(ref.url))
  : selectedRefs;

const planItems = workRefs.map((ref) => buildPlanItem(ref, refs, postsBySlug));
const urlMap = [];
const failures = [];
const summary = {
  mode: dryRun ? "dry-run" : "execute",
  totalRefs: refs.length,
  uniqueUrls: new Set(refs.map((ref) => ref.url)).size,
  selectedUrls: planItems.length,
  skippedUrls: dedupeByUrl(skippedRefs).length,
  downloadableUniqueUrls: uniqueRefs.length,
  downloaded: 0,
  reusedDownload: 0,
  uploaded: 0,
  reusedUpload: 0,
  mediaRowsCreated: 0,
  mediaRowsUpdated: 0,
  replacedUrls: 0,
  updatedPosts: 0,
  failures: 0,
  backupPath: null,
};

console.log(`[lilisong-media] mode=${summary.mode}`);
console.log(`[lilisong-media] refs=${summary.totalRefs}, unique=${summary.uniqueUrls}, downloadable=${summary.downloadableUniqueUrls}, selected=${summary.selectedUrls}`);

mkdirSync(reportsDir, { recursive: true });
writePlanReport(planItems, skippedRefs, summary);

if (dryRun) {
  writeJson(join(reportsDir, "lilisong-media-url-map.json"), planItems.map((item) => toPlanMapItem(item)));
  writeJson(join(reportsDir, "lilisong-media-failures.json"), []);
  writeSummary(summary, failures);
  console.log("[lilisong-media] dry-run complete; no download/upload/db update performed.");
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });

for (const item of planItems) {
  try {
    if (!args.skipDownload) {
      await ensureDownloaded(item);
    } else {
      const cached = findExistingCacheFile(item);
      if (!cached) throw new Error("skip-download set but cached file is missing.");
      item.cachePath = cached.path;
      item.contentType = cached.contentType;
      item.sizeBytes = cached.sizeBytes;
      item.filename = stableFilename(item.url, item.hash, cached.contentType);
      item.storagePath = buildStoragePath(item, item.filename);
      summary.reusedDownload += 1;
    }

    if (!args.skipUpload) await ensureUploaded(item);

    if (!args.skipDbUpdate) {
      await upsertMediaAsset(item, admin.id);
    }

    item.status = args.skipUpload ? "downloaded" : "ready";
    urlMap.push(toUrlMapItem(item));
  } catch (error) {
    item.status = "failed";
    const failure = {
      url: item.url,
      type: item.type,
      reason: error instanceof Error ? error.message : String(error),
      refs: item.refs.map((ref) => ({ slug: ref.slug, title: ref.title, isCover: ref.isCover })),
    };
    failures.push(failure);
    urlMap.push(toUrlMapItem(item, failure.reason));
    console.error(`failed ${item.url} ${failure.reason}`);
  }
}

if (!args.skipDbUpdate) {
  await backupAndReplacePosts(posts, urlMap.filter((item) => item.status === "ready"));
}

summary.failures = failures.length;
writeJson(join(reportsDir, "lilisong-media-url-map.json"), urlMap);
writeJson(join(reportsDir, "lilisong-media-failures.json"), failures);
writeSummary(summary, failures);
console.log(`[lilisong-media] execute complete: downloaded=${summary.downloaded}, uploaded=${summary.uploaded}, replacedUrls=${summary.replacedUrls}, failures=${summary.failures}`);

function buildPlanItem(ref, allRefs, postsBySlug) {
  const sameUrlRefs = allRefs.filter((item) => item.url === ref.url);
  const relatedPosts = sameUrlRefs.map((item) => postsBySlug.get(item.slug)).filter(Boolean);
  const firstPost = relatedPosts[0] ?? null;
  const bucket = relatedPosts.some((post) => post.visibility === "private") ? "private-media" : "public-media";
  const hash = sha1(ref.url).slice(0, 16);
  const initialFilename = stableFilename(ref.url, hash, null);
  const item = {
    url: ref.url,
    hash,
    type: ref.type,
    bucket,
    refs: sameUrlRefs,
    postId: firstPost?.id ?? null,
    postSlug: firstPost?.slug ?? ref.slug,
    yearMonth: firstPost ? yearMonthFromPost(firstPost) : null,
    filename: initialFilename,
    contentType: null,
    sizeBytes: null,
    cachePath: join(cacheDir, initialFilename),
    storagePath: null,
    publicUrl: null,
    status: "planned",
  };
  item.storagePath = buildStoragePath(item, initialFilename);
  return item;
}

async function ensureDownloaded(item) {
  const cached = findExistingCacheFile(item);
  if (cached) {
    item.cachePath = cached.path;
    item.contentType = cached.contentType;
    item.sizeBytes = cached.sizeBytes;
    item.filename = stableFilename(item.url, item.hash, cached.contentType);
    item.storagePath = buildStoragePath(item, item.filename);
    summary.reusedDownload += 1;
    return;
  }

  const response = await fetchWithRetry(item.url, 2, 20000);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || mimeFromName(item.filename) || "application/octet-stream";
  if (contentType.includes("text/html") && !looksLikeDownloadableUrl(item.url)) {
    throw new Error(`non-downloadable content-type: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = stableFilename(item.url, item.hash, contentType);
  const cachePath = join(cacheDir, filename);
  writeFileSync(cachePath, bytes);

  item.filename = filename;
  item.cachePath = cachePath;
  item.contentType = contentType;
  item.sizeBytes = bytes.byteLength;
  item.storagePath = buildStoragePath(item, filename);
  summary.downloaded += 1;
}

async function ensureUploaded(item) {
  const existing = mediaByPath.get(`${item.bucket}/${item.storagePath}`);
  if (existing) {
    item.publicUrl = existing.public_url || getPublicUrl(item.bucket, item.storagePath);
    item.contentType ||= existing.mime_type;
    item.sizeBytes ||= existing.size_bytes;
    summary.reusedUpload += 1;
    return;
  }

  const body = readFileSync(item.cachePath);
  const { error } = await supabase.storage.from(item.bucket).upload(item.storagePath, body, {
    cacheControl: "31536000",
    contentType: item.contentType || mimeFromName(item.filename) || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    const message = error.message || String(error);
    if (/maximum allowed size|exceeded/i.test(message)) {
      await uploadWithTus(item, body);
      summary.uploaded += 1;
      item.publicUrl = getPublicUrl(item.bucket, item.storagePath);
      return;
    }
    if (!/exist|duplicate|already/i.test(message)) throw error;
    summary.reusedUpload += 1;
  } else {
    summary.uploaded += 1;
  }

  item.publicUrl = getPublicUrl(item.bucket, item.storagePath);
}

async function uploadWithTus(item, body) {
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(body, {
      endpoint: storageUploadEndpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: item.bucket,
        objectName: item.storagePath,
        contentType: item.contentType || mimeFromName(item.filename) || "application/octet-stream",
        cacheControl: "31536000",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onSuccess: resolve,
    });
    upload.start();
  });
}

async function upsertMediaAsset(item, uploaderId) {
  const key = `${item.bucket}/${item.storagePath}`;
  const existing = mediaByPath.get(key);
  const payload = {
    uploader_id: uploaderId,
    post_id: item.postId,
    file_name: item.filename,
    mime_type: item.contentType || mimeFromName(item.filename) || "application/octet-stream",
    bucket: item.bucket,
    storage_path: item.storagePath,
    public_url: item.publicUrl,
    alt: null,
    caption: `Migrated from ${item.url}`,
    featured: false,
    size_bytes: item.sizeBytes,
  };

  if (existing) {
    const { error } = await supabase.from("media_assets").update(payload).eq("id", existing.id);
    if (error) throw error;
    summary.mediaRowsUpdated += 1;
  } else {
    const { data, error } = await supabase.from("media_assets").insert(payload).select("id, bucket, storage_path, public_url, file_name, mime_type, size_bytes").single();
    if (error) throw error;
    mediaByPath.set(key, data);
    summary.mediaRowsCreated += 1;
  }
}

async function backupAndReplacePosts(posts, readyItems) {
  if (readyItems.length === 0) return;

  const replacements = new Map(readyItems.map((item) => [item.oldUrl, item.newUrl]));
  const changedPosts = [];

  for (const post of posts) {
    let nextMarkdown = post.markdown ?? "";
    let nextCoverUrl = post.cover_url ?? null;
    let changed = false;

    for (const [oldUrl, newUrl] of replacements) {
      if (!newUrl) continue;
      if (nextMarkdown.includes(oldUrl)) {
        nextMarkdown = nextMarkdown.split(oldUrl).join(newUrl);
        changed = true;
      }
      if (nextCoverUrl === oldUrl) {
        nextCoverUrl = newUrl;
        changed = true;
      }
    }

    if (changed) {
      changedPosts.push({ post, nextMarkdown, nextCoverUrl });
    }
  }

  if (changedPosts.length === 0) return;

  mkdirSync(backupsDir, { recursive: true });
  const backupPath = join(backupsDir, `posts-media-backup-${timestamp}.json`);
  writeJson(backupPath, changedPosts.map(({ post }) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
    old_markdown: post.markdown,
    old_cover_url: post.cover_url,
    created_backup_time: now.toISOString(),
  })));
  summary.backupPath = backupPath;

  for (const { post, nextMarkdown, nextCoverUrl } of changedPosts) {
    const { error } = await supabase
      .from("posts")
      .update({ markdown: nextMarkdown, cover_url: nextCoverUrl })
      .eq("id", post.id);
    if (error) throw error;
    summary.updatedPosts += 1;
  }

  summary.replacedUrls = [...replacements.keys()].filter((oldUrl) =>
    changedPosts.some(({ post }) => (post.markdown ?? "").includes(oldUrl) || post.cover_url === oldUrl),
  ).length;
}

async function fetchWithRetry(url, retries, timeoutMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "lili-space-media-migrator/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function findExistingCacheFile(item) {
  if (!existsSync(cacheDir)) return null;
  const prefix = `${item.hash}-`;
  const fs = readdirSyncSafe(cacheDir);
  const filename = fs.find((name) => name.startsWith(prefix));
  if (!filename) return null;
  const path = join(cacheDir, filename);
  return {
    filename,
    path,
    contentType: mimeFromName(filename) || null,
    sizeBytes: statSync(path).size,
  };
}

function stableFilename(url, hash, contentType) {
  const rawName = basename(new URL(url).pathname) || "media";
  const decoded = safeDecodeURIComponent(rawName);
  const cleanBase = safeStorageFilename(decoded.replace(/\.[^.]*$/, "") || "media");
  const ext = extFromUrl(url) || extFromContentType(contentType) || ".bin";
  return `${hash}-${cleanBase}${ext}`;
}

function buildStoragePath(item, filename) {
  const ym = item.yearMonth;
  if (ym) return `lilisong/${ym.year}/${ym.month}/${filename}`;
  return `lilisong/unknown/${filename}`;
}

function getPublicUrl(bucket, storagePath) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

function buildStorageUploadEndpoint(url) {
  const hostname = new URL(url).hostname;
  const projectId = hostname.split(".")[0];
  return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
}

function yearMonthFromPost(post) {
  const rawDate = post.published_at || post.created_at;
  if (!rawDate) return null;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, "0"),
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function writePlanReport(items, skipped, planSummary) {
  const byType = countBy(items.map((item) => item.type));
  const lines = [
    "# lilisong 媒体迁移计划",
    "",
    `- 模式：${planSummary.mode}`,
    `- 总媒体引用：${planSummary.totalRefs}`,
    `- 去重 URL：${planSummary.uniqueUrls}`,
    `- 本次选择 URL：${planSummary.selectedUrls}`,
    `- 可下载去重 URL：${planSummary.downloadableUniqueUrls}`,
    `- 跳过 URL：${planSummary.skippedUrls}`,
    `- public-media：${items.filter((item) => item.bucket === "public-media").length}`,
    `- private-media：${items.filter((item) => item.bucket === "private-media").length}`,
    "",
    "## 类型统计",
    "",
    ...Object.entries(byType).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## 跳过规则",
    "",
    `- iframe / 非文件型 URL：${dedupeByUrl(skipped).length}`,
    "",
    "## URL 计划",
    "",
    ...items.map((item) => `- ${item.type} ${item.bucket}/${item.storagePath} <- ${item.url}`),
  ];
  writeFileSync(join(reportsDir, "lilisong-media-migration-plan.md"), `${lines.join("\n")}\n`);
}

function writeSummary(data, failures) {
  const lines = [
    "# lilisong 媒体迁移汇总",
    "",
    `- 模式：${data.mode}`,
    `- 总媒体引用：${data.totalRefs}`,
    `- 去重 URL：${data.uniqueUrls}`,
    `- 本次选择 URL：${data.selectedUrls}`,
    `- 成功下载：${data.downloaded}`,
    `- 复用下载缓存：${data.reusedDownload}`,
    `- 成功上传：${data.uploaded}`,
    `- 复用已上传文件：${data.reusedUpload}`,
    `- media_assets created：${data.mediaRowsCreated}`,
    `- media_assets updated：${data.mediaRowsUpdated}`,
    `- 成功替换 URL：${data.replacedUrls}`,
    `- 更新文章：${data.updatedPosts}`,
    `- 失败 URL：${data.failures}`,
    `- 备份文件：${data.backupPath ?? "未生成"}`,
    "",
    "## 失败摘要",
    "",
    ...(failures.length ? failures.map((item) => `- ${item.url}: ${item.reason}`) : ["- 无"]),
  ];
  writeFileSync(join(reportsDir, "lilisong-media-migration-summary.md"), `${lines.join("\n")}\n`);
}

function toPlanMapItem(item) {
  return {
    status: "planned",
    oldUrl: item.url,
    type: item.type,
    bucket: item.bucket,
    storagePath: item.storagePath,
    refs: item.refs,
  };
}

function toUrlMapItem(item, error) {
  return {
    status: item.status,
    oldUrl: item.url,
    newUrl: item.publicUrl,
    type: item.type,
    bucket: item.bucket,
    storagePath: item.storagePath,
    cachePath: item.cachePath,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    refs: item.refs,
    error,
  };
}

function readPreviousFailures() {
  const path = join(reportsDir, "lilisong-media-failures.json");
  if (!existsSync(path)) return new Set();
  return new Set(JSON.parse(readFileSync(path, "utf8")).map((item) => item.url));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
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

function parseArgs(argv) {
  const parsed = {
    dryRun: argv.includes("--dry-run"),
    execute: argv.includes("--execute"),
    onlyImages: argv.includes("--only-images"),
    onlyVideos: argv.includes("--only-videos"),
    retryFailed: argv.includes("--retry-failed"),
    skipDownload: argv.includes("--skip-download"),
    skipUpload: argv.includes("--skip-upload"),
    skipDbUpdate: argv.includes("--skip-db-update"),
    limit: null,
  };
  const limitIndex = argv.indexOf("--limit");
  if (limitIndex >= 0) parsed.limit = argv[limitIndex + 1];
  if (parsed.dryRun) parsed.execute = false;
  return parsed;
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeFilename(value) {
  return value
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "media";
}

function safeStorageFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "media";
}

function extFromUrl(url) {
  const pathname = new URL(url).pathname;
  const decoded = safeDecodeURIComponent(pathname);
  const ext = extname(decoded).toLowerCase();
  if (/^\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v|mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)) return ext;
  return null;
}

function extFromContentType(contentType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
  };
  return map[String(contentType ?? "").toLowerCase()] ?? null;
}

function mimeFromName(name) {
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
  };
  return map[extname(name).toLowerCase()] ?? null;
}

function looksLikeDownloadableUrl(url) {
  return Boolean(extFromUrl(url));
}

function readdirSyncSafe(path) {
  try {
    return existsSync(path) ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
