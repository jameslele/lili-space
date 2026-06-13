import { createClient } from "@supabase/supabase-js";

import { supabaseEnv } from "../supabase-env";

export function createServerSupabaseClient() {
  if (!supabaseEnv.url || !supabaseEnv.anonKey) {
    throw new Error("Missing Supabase server client environment variables.");
  }

  return createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createServiceRoleSupabaseClient() {
  if (!supabaseEnv.url || !supabaseEnv.serviceRoleKey) {
    throw new Error("Missing Supabase service role environment variables.");
  }

  return createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
