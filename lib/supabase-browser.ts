import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  client = createBrowserClient(url, key);
  return client;
}

// Keep the client lazy so Next.js can build the public shell without Supabase
// environment variables. The real values are still required at runtime.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    return Reflect.get(getClient() as object, property);
  },
});
