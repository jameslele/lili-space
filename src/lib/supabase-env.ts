export const supabaseEnv = {
  url: import.meta.env.SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL ?? "",
  anonKey: import.meta.env.SUPABASE_ANON_KEY ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "",
  serviceRoleKey: import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  publicBucket: import.meta.env.SUPABASE_STORAGE_PUBLIC_BUCKET ?? "public-media",
  privateBucket: import.meta.env.SUPABASE_STORAGE_PRIVATE_BUCKET ?? "private-media",
};
