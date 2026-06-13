import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(path = ".env") {
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

loadEnv();

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

const expectedCategories = [
  "游游逛逛",
  "卿卿我我",
  "少侠",
  "浮光片影",
  "但是还有书籍",
  "四季流转",
  "花花草草",
  "网站日记",
  "码农小知识",
  "未分类",
];

const { data: admin, error: adminError } = await supabase
  .from("users")
  .select("username, role, password_hash")
  .eq("username", "root")
  .single();
if (adminError) throw adminError;

const { data: categories, error: categoryError } = await supabase
  .from("categories")
  .select("name, slug, sort_order")
  .order("sort_order", { ascending: true });
if (categoryError) throw categoryError;

const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
if (bucketError) throw bucketError;

const bucketSummary = buckets
  .filter((bucket) => bucket.name === "public-media" || bucket.name === "private-media")
  .map((bucket) => ({ name: bucket.name, public: bucket.public }));

const result = {
  admin: {
    username: admin.username,
    role: admin.role,
    password_hash_is_bcrypt: admin.password_hash.startsWith("$2"),
    password_hash_looks_like_hash: admin.password_hash.length > 20,
  },
  categories: {
    count: categories.length,
    names: categories.map((category) => category.name),
    all_expected_present: expectedCategories.every((name) =>
      categories.some((category) => category.name === name),
    ),
  },
  buckets: bucketSummary,
};

console.log(JSON.stringify(result, null, 2));
