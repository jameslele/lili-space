import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(path = ".env") {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    execute: false,
    limit: 12,
    ids: [],
    postSlug: null,
    filenameIncludes: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--dry-run") {
      args.dryRun = true;
      args.execute = false;
    } else if (arg === "--execute") {
      args.execute = true;
      args.dryRun = false;
    } else if (arg === "--limit" && next) {
      args.limit = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--ids" && next) {
      args.ids = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--post-slug" && next) {
      args.postSlug = next;
      index += 1;
    } else if (arg === "--filename-includes" && next) {
      args.filenameIncludes = next;
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run gallery:feature -- --dry-run [--limit 12]
  npm run gallery:feature -- --execute [--limit 12]
  npm run gallery:feature -- --dry-run --post-slug article-slug
  npm run gallery:feature -- --execute --ids id1,id2,id3
  npm run gallery:feature -- --dry-run --filename-includes IMG_

Notes:
  - Only public-media images are eligible.
  - Dry-run is the default.
  - The script only sets media_assets.featured = true.`);
}

async function getPostIdBySlug(supabase, slug) {
  const { data, error } = await supabase.from("posts").select("id, title, slug").eq("slug", slug).single();
  if (error) throw error;
  return data;
}

async function getCounts(supabase) {
  const [totalImages, featuredImages] = await Promise.all([
    supabase
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("bucket", "public-media")
      .like("mime_type", "image/%"),
    supabase
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("bucket", "public-media")
      .like("mime_type", "image/%")
      .eq("featured", true),
  ]);

  if (totalImages.error) throw totalImages.error;
  if (featuredImages.error) throw featuredImages.error;

  return {
    publicImages: totalImages.count ?? 0,
    publicFeaturedImages: featuredImages.count ?? 0,
  };
}

async function getCandidates(supabase, args) {
  let post = null;
  if (args.postSlug) post = await getPostIdBySlug(supabase, args.postSlug);

  let query = supabase
    .from("media_assets")
    .select("id, file_name, mime_type, bucket, storage_path, public_url, post_id, featured, created_at")
    .eq("bucket", "public-media")
    .like("mime_type", "image/%")
    .eq("featured", false)
    .order("created_at", { ascending: false });

  if (args.ids.length > 0) {
    query = query.in("id", args.ids);
  } else {
    query = query.limit(args.limit);
  }

  if (post) query = query.eq("post_id", post.id);
  if (args.filenameIncludes) query = query.ilike("file_name", `%${args.filenameIncludes}%`);

  const { data, error } = await query;
  if (error) throw error;

  return { post, candidates: data ?? [] };
}

function printCandidateSummary(candidates) {
  if (candidates.length === 0) {
    console.log("No eligible public images found.");
    return;
  }

  console.table(
    candidates.map((item) => ({
      id: item.id,
      file_name: item.file_name,
      featured: item.featured,
      created_at: item.created_at,
    })),
  );
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const args = parseArgs(process.argv.slice(2));
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const before = await getCounts(supabase);
const { post, candidates } = await getCandidates(supabase, args);

console.log(JSON.stringify({
  mode: args.execute ? "execute" : "dry-run",
  filters: {
    limit: args.limit,
    ids: args.ids,
    post_slug: post?.slug ?? args.postSlug,
    filename_includes: args.filenameIncludes,
  },
  before,
  candidate_count: candidates.length,
}, null, 2));

printCandidateSummary(candidates);

if (args.execute && candidates.length > 0) {
  const ids = candidates.map((item) => item.id);
  const { error } = await supabase.from("media_assets").update({ featured: true }).in("id", ids);
  if (error) throw error;
}

const after = await getCounts(supabase);
console.log(JSON.stringify({
  mode: args.execute ? "execute" : "dry-run",
  updated_count: args.execute ? candidates.length : 0,
  after,
}, null, 2));
