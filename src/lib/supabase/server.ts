import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientOptions } from "@supabase/supabase-js";
import WebSocket from "ws";

import { supabaseEnv } from "../supabase-env";

const realtimeOptions: RealtimeClientOptions = {
  // EdgeOne currently runs Node 20 in some deployments, which has no native WebSocket.
  // Supabase initializes Realtime during createClient(), so provide a server transport.
  transport: WebSocket as RealtimeClientOptions["transport"],
};

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
    realtime: realtimeOptions,
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
    realtime: realtimeOptions,
  });
}
