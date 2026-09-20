import type { SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  phone: string;
  username: string | null;
  full_name: string;
  avatar_url: string | null;
  about: string | null;
  is_online: boolean;
  last_seen_at: string | null;
};

export async function getOrCreateDirectConversation(
  supabase: SupabaseClient,
  otherUserId: string,
) {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) throw new Error("You must be logged in.");
  if (me.user.id === otherUserId) throw new Error("You cannot message yourself.");

  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    other_user_id: otherUserId,
  });

  if (error) throw error;
  if (!data) throw new Error("Unable to create conversation.");
  return data as string;
}
