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

  const userIds = [me.user.id, otherUserId].sort();

  const { data: existing, error: existingError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .in("user_id", userIds);

  if (existingError) throw existingError;

  const counts = new Map<string, number>();
  for (const row of existing ?? []) {
    counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1);
  }

  const existingDirect = [...counts.entries()].find(([, count]) => count === 2);
  if (existingDirect) return existingDirect[0];

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({ kind: "direct" })
    .select("id")
    .single();

  if (conversationError) throw conversationError;

  const { error: membersError } = await supabase
    .from("conversation_members")
    .insert(userIds.map((user_id) => ({ conversation_id: conversation.id, user_id })));

  if (membersError) throw membersError;
  return conversation.id;
}
