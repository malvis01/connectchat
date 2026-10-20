import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createWalletSession() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public environment variables are not configured.");
  const cookieStore = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Route handlers can still read an existing session when cookies are read-only. */ }
      }
    }
  });
  const { data, error } = await client.auth.getUser();
  return { client, user: data.user, authError: error };
}
