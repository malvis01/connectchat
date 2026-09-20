"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Search, Send, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { getOrCreateDirectConversation, type Profile } from "@/lib/connectchat";

type Message = {
  id: string;
  body: string | null;
  sender_id: string;
  message_type: string;
  created_at: string;
  edited_at: string | null;
};

export default function ChatPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/auth";
        return;
      }

      const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (mounted && me) setProfile(me);

      const { data: users } = await supabase
        .from("profiles")
        .select("*")
        .neq("id", user.id)
        .order("full_name");

      if (mounted) setPeople(users ?? []);
    })();

    return () => { mounted = false; };
  }, []);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((person) =>
      person.full_name.toLowerCase().includes(q) ||
      (person.username ?? "").toLowerCase().includes(q) ||
      person.phone.toLowerCase().includes(q)
    );
  }, [people, query]);

  async function openChat(person: Profile) {
    setSelected(person);
    setError("");
    try {
      const id = await getOrCreateDirectConversation(supabase, person.id);
      setConversationId(id);

      const { data, error: readError } = await supabase
        .from("messages")
        .select("id,body,sender_id,message_type,created_at,edited_at")
        .eq("conversation_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (readError) throw readError;
      setMessages(data ?? []);

      await supabase
        .channel(`chat:${id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${id}`,
        }, (payload) => {
          const message = payload.new as Message;
          setMessages((current) =>
            current.some((item) => item.id === message.id) ? current : [...current, message],
          );
        })
        .subscribe();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open conversation.");
    }
  }

  async function sendMessage() {
    if (!conversationId || !profile || !draft.trim()) return;
    const body = draft.trim();
    setDraft("");

    const { error: sendError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: profile.id,
      body,
      message_type: "text",
    });

    if (sendError) {
      setDraft(body);
      setError(sendError.message);
    }
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <div className="auth-brand" style={{margin:0}}>
            <span className="auth-logo"><MessageCircle size={21}/></span>
            <div><strong>ConnectChat</strong><span>Private chats</span></div>
          </div>
          <button className="icon-button" title="Profile"><UserRound size={19}/></button>
        </div>

        <div className="search-box">
          <Search size={17}/>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people by name, username or phone"/>
        </div>

        <div className="people-list">
          {filteredPeople.map((person) => (
            <button key={person.id} className={`person-row ${selected?.id === person.id ? "active" : ""}`} onClick={() => openChat(person)}>
              <span className="person-avatar">{person.full_name.slice(0,1).toUpperCase()}</span>
              <span className="person-info"><strong>{person.full_name}</strong><small>{person.username ? `@${person.username}` : person.phone}</small></span>
              <span className={`presence ${person.is_online ? "online" : ""}`}/>
            </button>
          ))}
          {!filteredPeople.length && <p className="empty-state">No other users yet.</p>}
        </div>
      </aside>

      <section className="chat-panel">
        {!selected ? (
          <div className="chat-empty">
            <MessageCircle size={42}/>
            <h1>Start a private conversation</h1>
            <p>Choose a person from the left to begin messaging in real time.</p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <span className="person-avatar">{selected.full_name.slice(0,1).toUpperCase()}</span>
              <div><strong>{selected.full_name}</strong><small>{selected.is_online ? "online" : "offline"}</small></div>
            </header>

            <div className="message-list">
              {messages.map((message) => {
                const mine = message.sender_id === profile?.id;
                return <div key={message.id} className={`message-row ${mine ? "mine" : ""}`}>
                  <div className="message-bubble">
                    {message.body}
                    <time>{new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</time>
                  </div>
                </div>;
              })}
              {!messages.length && <p className="empty-state">No messages yet. Say hello.</p>}
            </div>

            <div className="composer">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder="Write a message…" />
              <button className="send-button" onClick={() => void sendMessage()} disabled={!draft.trim()}><Send size={18}/></button>
            </div>
          </>
        )}
        {error && <div className="chat-error">{error}</div>}
      </section>
    </main>
  );
}
