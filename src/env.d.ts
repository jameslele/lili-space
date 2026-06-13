/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { CurrentUser } from "./lib/auth";

interface ImportMetaEnv {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly SUPABASE_STORAGE_PUBLIC_BUCKET?: string;
  readonly SUPABASE_STORAGE_PRIVATE_BUCKET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  namespace App {
    interface Locals {
      currentUser: CurrentUser | null;
    }
  }
}
