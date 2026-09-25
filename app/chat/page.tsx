"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImagePlus, MessageCircle, Mic, Paperclip, Phone, Play, Search, Send, Smile, Square, Sticker, UserRound, Video, X } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { getOrCreateDirectConversation, type Profile } from "@/lib/connectchat";
import { decryptText, encryptText, ensureE2EEKeypair } from "@/lib/e2ee";
import { decryptBlob, encryptFile } from "@/lib/e2ee-media";
import { listContactDevices, listTrustedDevices, registerE2EEDevice, rotateAndRegisterE2EEDevice, trustE2EEDevice } from "@/lib/e2ee-key-management";

type Attachment = {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
};

type Reaction = { message_id: string; user_id: string; emoji: string };
type Sticker = { id: string; pack_id: string; name: string; image_url: string };
type Message = {
  id: string;
  body: string | null;
  sender_id: string;
  message_type: string;
  created_at: string;
  edited_at: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
};

const DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function AudioMessage({ src, duration }: { src: string; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const toggle = async () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) await audioRef.current.play();
    else audioRef.current.pause();
  };
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);
  return (
    <div className="voice-message">
      <audio ref={audioRef} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button className="voice-play" onClick={() => void toggle()}>{playing ? <Square size={15}/> : <Play size={15}/>}</button>
      <div className="voice-wave"><span/><span/><span/><span/><span/><span/><span/><span/></div>
      <small>{duration ? `${Math.round(duration)}s` : "Voice"}</small>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
        <option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option>
      </select>
    </div>
  );
}

export default function ChatPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const emojiList = ["😀","😂","😍","😊","😎","😭","😢","😡","👍","👎","❤️","🔥","🎉","🙏","👏","💯","🤣","😮","🤔","🥰"];
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [otherOnline, setOtherOnline] = useState(false);
  const [call,setCall]=useState<{id:string;type:"voice"|"video";incoming:boolean;status:string}|null>(null);
  const [callSeconds,setCallSeconds]=useState(0);
  const [callMuted,setCallMuted]=useState(false);
  const [cameraOff,setCameraOff]=useState(false);
  const [localStream,setLocalStream]=useState<MediaStream|null>(null);
  const [remoteStream,setRemoteStream]=useState<MediaStream|null>(null);
  const [e2eeReady, setE2eeReady] = useState(false);
  const [contactDevices, setContactDevices] = useState<Array<{id:string;device_name:string;public_key:string;fingerprint:string;created_at:string;last_seen_at:string;revoked_at:string|null}>>([]);
  const [trustedDevices, setTrustedDevices] = useState<Array<{id:string;contact_user_id:string;device_id:string;fingerprint:string;verified_at:string;updated_at:string}>>([]);
  const [verificationWarning, setVerificationWarning] = useState("");
  const [showVerification, setShowVerification] = useState(false);
  const peerRef=useRef<RTCPeerConnection|null>(null);
  const callChannelRef=useRef<ReturnType<typeof supabase.channel>|null>(null);
  const callTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/auth"; return; }
      const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (mounted && me) {
        const keys = await ensureE2EEKeypair();
        if (me.e2ee_public_key !== keys.publicKey) {
          await supabase.from("profiles").update({ e2ee_public_key: keys.publicKey }).eq("id", user.id);
          me.e2ee_public_key = keys.publicKey;
        }
        await registerE2EEDevice(user.id);
        setE2eeReady(true);
        setProfile(me);
        await supabase.from("profiles").update({ is_online: true, last_seen_at: new Date().toISOString() }).eq("id", user.id);
      }
      const { data: users } = await supabase.from("profiles").select("*").neq("id", user.id).order("full_name");
      if (mounted) setPeople(users ?? []);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel(`user-call:${profile.id}`);
    channel.on("broadcast", { event: "invite" }, async ({ payload }) => {
      if (!payload?.callId || payload.from === profile.id) return;
      const { data: caller } = await supabase.from("profiles").select("*").eq("id", payload.from).maybeSingle();
      if (!caller) return;
      setSelected(caller);
      setConversationId(payload.conversationId ?? null);
      setCall({ id: payload.callId, type: payload.callType === "video" ? "video" : "voice", incoming: true, status: "ringing" });
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile]);

  useEffect(() => {
    if (!call || call.status !== "active") return;
    setCallSeconds(0);
    callTimerRef.current = setInterval(() => setCallSeconds((seconds) => seconds + 1), 1000);
    return () => { if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; } };
  }, [call?.id, call?.status]);

  useEffect(() => {
    if (!profile) return;
    const markOffline = () => { void supabase.from("profiles").update({ is_online: false, last_seen_at: new Date().toISOString() }).eq("id", profile.id); };
    const markOnline = () => { void supabase.from("profiles").update({ is_online: true, last_seen_at: new Date().toISOString() }).eq("id", profile.id); };
    const onVisibility = () => document.visibilityState === "visible" ? markOnline() : markOffline();
    window.addEventListener("beforeunload", markOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", markOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      markOffline();
    };
  }, [profile]);

  useEffect(() => () => {
    if (channelRef.current) void supabase.removeChannel(channelRef.current);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (recordTimer.current) clearInterval(recordTimer.current);
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
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

  async function loadAttachments(items: Message[]) {
    if (!items.length) return items;
    const ids = items.map((m) => m.id);
    const { data } = await supabase.from("message_attachments").select("*").in("message_id", ids);
    const byMessage = new Map<string, Attachment[]>();
    (data ?? []).forEach((a) => byMessage.set(a.message_id, [...(byMessage.get(a.message_id) ?? []), a]));
    const { data: reactionRows } = await supabase.from("message_reactions").select("message_id,user_id,emoji").in("message_id", ids);
    const byReaction = new Map<string, Reaction[]>();
    (reactionRows ?? []).forEach((r) => byReaction.set(r.message_id, [...(byReaction.get(r.message_id) ?? []), r]));
    return items.map((m) => ({ ...m, attachments: byMessage.get(m.id) ?? [], reactions: byReaction.get(m.id) ?? [] }));
  }

  async function getSignedUrl(path: string) {
    const { data, error: urlError } = await supabase.storage.from("connectchat-media").createSignedUrl(path, 3600);
    if (urlError) throw urlError;
    return data.signedUrl;
  }

  async function loadStickers() {
    const { data } = await supabase.from("stickers").select("id,pack_id,name,image_url").order("sort_order").limit(60);
    setStickers(data ?? []);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!profile || !conversationId) return;
    const existing = reactions[messageId]?.find((r) => r.user_id === profile.id && r.emoji === emoji);
    const result = existing
      ? await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", profile.id).eq("emoji", emoji)
      : await supabase.from("message_reactions").insert({ message_id: messageId, user_id: profile.id, emoji });
    if (result.error) { setError(result.error.message); return; }
    const next = existing
      ? (reactions[messageId] ?? []).filter((r) => !(r.user_id === profile.id && r.emoji === emoji))
      : [...(reactions[messageId] ?? []), { message_id: messageId, user_id: profile.id, emoji }];
    setReactions((current) => ({ ...current, [messageId]: next }));
    await channelRef.current?.send({ type: "broadcast", event: "reaction", payload: { messageId, emoji, userId: profile.id, active: !existing } });
  }

  async function sendSticker(sticker: Sticker) {
    if (!conversationId || !profile) return;
    const { error: sendError } = await supabase.from("messages").insert({
      conversation_id: conversationId, sender_id: profile.id, body: sticker.image_url, message_type: "sticker"
    });
    if (sendError) setError(sendError.message);
    setShowStickers(false);
  }

  async function endCall(status:"ended"|"declined"|"missed"|"failed"="ended", notifyRemote=true){
    if(!call)return;
    if (notifyRemote) await callChannelRef.current?.send({type:"broadcast",event:"signal",payload:{from:profile?.id,type:status==="declined"?"decline":"hangup"}});
    await supabase.from("calls").update({status,ended_at:new Date().toISOString()}).eq("id",call.id);
    peerRef.current?.close(); peerRef.current=null;
    localStream?.getTracks().forEach(t=>t.stop()); setLocalStream(null); setRemoteStream(null); setCall(null); setCallSeconds(0);
    if(callChannelRef.current){await supabase.removeChannel(callChannelRef.current);callChannelRef.current=null;}
    if(callTimerRef.current){clearInterval(callTimerRef.current);callTimerRef.current=null;}
  }

  async function startCall(type:"voice"|"video"){
    if(!conversationId||!profile||!selected||call)return;
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"});
      const {data,error:rowError}=await supabase.from("calls").insert({conversation_id:conversationId,initiated_by:profile.id,call_type:type,status:"ringing"}).select("id").single();
      if(rowError||!data)throw rowError??new Error("Could not create call.");
      await supabase.from("call_participants").insert({call_id:data.id,user_id:profile.id,joined_at:new Date().toISOString()});
      const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
      media.getTracks().forEach(t=>pc.addTrack(t,media)); pc.ontrack=e=>setRemoteStream(e.streams[0]??null);
      const ch=supabase.channel("call:"+data.id);
      ch.on("broadcast",{event:"signal"},async({payload})=>{
        if(payload?.from===profile.id)return;
        if(payload.type==="ready"){
          const offer=await pc.createOffer();
          await pc.setLocalDescription(offer);
          await ch.send({type:"broadcast",event:"signal",payload:{from:profile.id,type:"offer",offer}});
        }
        if(payload.type==="answer"){await pc.setRemoteDescription(payload.answer);await supabase.from("calls").update({status:"active",started_at:new Date().toISOString()}).eq("id",data.id);setCall(c=>c?{...c,status:"active"}:c);}
        if(payload.type==="ice"&&payload.candidate)await pc.addIceCandidate(payload.candidate);
        if(payload.type==="decline"||payload.type==="hangup")await endCall(payload.type==="decline"?"declined":"ended",false);
      }).subscribe();
      const invite=supabase.channel(`user-call:${selected.id}`);
      invite.subscribe(async status=>{if(status==="SUBSCRIBED"){await invite.send({type:"broadcast",event:"invite",payload:{from:profile.id,callId:data.id,callType:type,conversationId}});setTimeout(()=>{void supabase.removeChannel(invite)},5000);}});
      pc.onicecandidate=e=>{if(e.candidate)void ch.send({type:"broadcast",event:"signal",payload:{from:profile.id,type:"ice",candidate:e.candidate}})};
      setLocalStream(media);setCall({id:data.id,type,incoming:false,status:"ringing"});callChannelRef.current=ch;peerRef.current=pc;
    }catch(e){setError(e instanceof Error?e.message:"Could not start call.");}
  }

  async function acceptCall(callId:string,type:"voice"|"video"){
    if(!profile)return;
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"});
      const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
      media.getTracks().forEach(t=>pc.addTrack(t,media)); pc.ontrack=e=>setRemoteStream(e.streams[0]??null);
      const ch=supabase.channel("call:"+callId);
      ch.on("broadcast",{event:"signal"},async({payload})=>{
        if(payload?.from===profile.id)return;
        if(payload.type==="offer"){await pc.setRemoteDescription(payload.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await ch.send({type:"broadcast",event:"signal",payload:{from:profile.id,type:"answer",answer}});await supabase.from("calls").update({status:"active",started_at:new Date().toISOString()}).eq("id",callId);}
        if(payload.type==="ice"&&payload.candidate)await pc.addIceCandidate(payload.candidate);
        if(payload.type==="hangup")await endCall("ended",false);
      }).subscribe(async status=>{if(status==="SUBSCRIBED"){await ch.send({type:"broadcast",event:"signal",payload:{from:profile.id,type:"ready"}});}});
      pc.onicecandidate=e=>{if(e.candidate)void ch.send({type:"broadcast",event:"signal",payload:{from:profile.id,type:"ice",candidate:e.candidate}})};
      await supabase.from("call_participants").upsert({call_id:callId,user_id:profile.id,joined_at:new Date().toISOString()});
      setLocalStream(media);setCall(c=>c?{...c,status:"active"}:c);callChannelRef.current=ch;peerRef.current=pc;
    }catch(e){setError(e instanceof Error?e.message:"Could not accept call.");}
  }

  async function openChat(person: Profile) {
    setSelected(person); setMessages([]); setTyping(false); setError("");
    if (channelRef.current) { await supabase.removeChannel(channelRef.current); channelRef.current = null; }
    try {
      const id = await getOrCreateDirectConversation(supabase, person.id);
      setConversationId(id);
      const [devices, trusted] = await Promise.all([listContactDevices(person.id), listTrustedDevices(person.id)]);
      setContactDevices(devices);
      setTrustedDevices(trusted);
      const trustedByDevice = new Map(trusted.map((item) => [item.device_id, item.fingerprint]));
      const changed = devices.some((device) => trustedByDevice.has(device.id) && trustedByDevice.get(device.id) !== device.fingerprint);
      const newDevice = devices.some((device) => !trustedByDevice.has(device.id));
      setVerificationWarning(changed ? "Security warning: this contact's encryption key changed on a trusted device. Verify the new fingerprint before trusting it." : newDevice ? "This contact has an unverified encryption device. Verify the fingerprint before trusting it." : "");
      setShowVerification(false);
      const { data, error: readError } = await supabase.from("messages")
        .select("id,body,sender_id,message_type,created_at,edited_at").eq("conversation_id", id)
        .is("deleted_at", null).order("created_at", { ascending: true });
      if (readError) throw readError;
      const decrypted = await Promise.all((data ?? []).map(async (m) => ({
        ...m,
        body: m.body && m.message_type === "text" && person.e2ee_public_key ? await decryptText(m.body, person.e2ee_public_key).catch(() => "🔒 Unable to decrypt this message") : m.body,
        attachments: [],
        reactions: [],
      })));
      const loaded = await loadAttachments(decrypted);
      setMessages(loaded);
      const reactionMap: Record<string, Reaction[]> = {};
      loaded.forEach((m) => { reactionMap[m.id] = m.reactions; });
      setReactions(reactionMap);
      void loadStickers();

      const channel = supabase.channel(`chat:${id}`, { config: { presence: { key: profile?.id ?? "anonymous" } } });
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, async (payload) => {
          const raw = payload.new as Message;
          const message = {
            ...raw,
            body: raw.body && raw.message_type === "text" && person.e2ee_public_key ? await decryptText(raw.body, person.e2ee_public_key).catch(() => "🔒 Unable to decrypt this message") : raw.body,
          };
          // Attachment rows are created immediately after the message row. Realtime can
          // deliver the message INSERT before the attachment INSERT is visible, so retry
          // briefly instead of showing a permanent attachment-less message.
          let attachments: Attachment[] = [];
          for (let attempt = 0; attempt < 4; attempt += 1) {
            const { data } = await supabase.from("message_attachments").select("*").eq("message_id", message.id);
            attachments = (data ?? []) as Attachment[];
            if (attachments.length || message.message_type === "text" || message.message_type === "sticker") break;
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          }
          setMessages((current) => current.some((item) => item.id === message.id)
            ? current.map((item) => item.id === message.id && item.attachments.length === 0 && attachments.length
              ? { ...item, attachments }
              : item)
            : [...current, { ...message, attachments, reactions: [] }]);
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => { if (payload?.userId === person.id) setTyping(Boolean(payload.isTyping)); })
        .on("broadcast", { event: "reaction" }, ({ payload }) => {
          if (!payload?.messageId || payload.userId === profile?.id) return;
          setReactions((current) => {
            const list = current[payload.messageId] ?? [];
            const exists = list.some((r) => r.user_id === payload.userId && r.emoji === payload.emoji);
            const next = payload.active && !exists
              ? [...list, { message_id: payload.messageId, user_id: payload.userId, emoji: payload.emoji }]
              : payload.active ? list : list.filter((r) => !(r.user_id === payload.userId && r.emoji === payload.emoji));
            return { ...current, [payload.messageId]: next };
          });
        })
        .on("presence", { event: "sync" }, () => { const state = channel.presenceState(); setOtherOnline(Boolean(state[person.id]?.length)); })
        .subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({ userId: profile?.id, onlineAt: new Date().toISOString() }); });
      channelRef.current = channel;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open conversation."); }
  }

  async function broadcastTyping(isTyping: boolean) {
    if (!channelRef.current || !profile) return;
    await channelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: profile.id, isTyping } });
  }

  function handleDraftChange(value: string) {
    setDraft(value); void broadcastTyping(Boolean(value.trim()));
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (value.trim()) typingTimer.current = setTimeout(() => void broadcastTyping(false), 1200);
  }

  async function rotateMyEncryptionKey() {
    if (!profile) return;
    try {
      const result = await rotateAndRegisterE2EEDevice(profile.id);
      await supabase.from("profiles").update({ e2ee_public_key: result.public_key }).eq("id", profile.id);
      setProfile((current) => current ? { ...current, e2ee_public_key: result.publicKey } : current);
      setError("Encryption key rotated. Your previous keys remain locally available for older messages.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate encryption key.");
    }
  }

  async function sendMessage() {
    if (!conversationId || !profile || !draft.trim()) return;
    const body = draft.trim(); setDraft(""); void broadcastTyping(false);
    if (!selected?.e2ee_public_key) { setDraft(body); setError("This user has not enabled secure messaging yet."); return; }
    const encryptedBody = await encryptText(body, selected.e2ee_public_key);
    const { error: sendError } = await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: profile.id, body: encryptedBody, message_type: "text" });
    if (sendError) { setDraft(body); setError(sendError.message); }
  }

  async function sendFiles(files: FileList | File[]) {
    if (!conversationId || !profile) return;
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;
    setUploading(true); setError("");
    try {
      for (const file of selectedFiles) {
        const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "voice" : "file";
        if (file.size > 50 * 1024 * 1024) throw new Error("Each file must be 50 MB or smaller.");
        const path = `${conversationId}/${profile.id}/${crypto.randomUUID()}-${safeName(file.name)}.enc`;
        if (!selected?.e2ee_public_key) throw new Error("Secure media is unavailable for this user.");
        const encrypted = await encryptFile(file, selected.e2ee_public_key);
        const { error: uploadError } = await supabase.storage.from("connectchat-media").upload(path, encrypted, { contentType: "application/octet-stream", upsert: false });
        if (uploadError) throw uploadError;
        const { data: message, error: messageError } = await supabase.from("messages").insert({
          conversation_id: conversationId, sender_id: profile.id, message_type: kind
        }).select("id").single();
        if (messageError) throw messageError;
        const { error: attachmentError } = await supabase.from("message_attachments").insert({
          message_id: message.id, storage_path: path, file_name: file.name, mime_type: file.type || "application/octet-stream",
          file_size: file.size, width: kind === "image" ? undefined : null, height: kind === "image" ? undefined : null
        });
        if (attachmentError) throw attachmentError;
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  async function startRecording() {
    if (!conversationId || !profile) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice recording is not supported by this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mime });
        const seconds = recordSeconds;
        setUploading(true);
        try {
          const path = `${conversationId}/${profile.id}/${crypto.randomUUID()}.webm.enc`;
          if (!selected?.e2ee_public_key) throw new Error("Secure media is unavailable for this user.");
          const encrypted = await encryptFile(new File([blob], "voice-message.webm", { type: mime }), selected.e2ee_public_key);
          const { error: uploadError } = await supabase.storage.from("connectchat-media").upload(path, encrypted, { contentType: "application/octet-stream", upsert: false });
          if (uploadError) throw uploadError;
          const { data: message, error: messageError } = await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: profile.id, message_type: "voice" }).select("id").single();
          if (messageError) throw messageError;
          const { error: attachmentError } = await supabase.from("message_attachments").insert({ message_id: message.id, storage_path: path, file_name: "voice-message.webm", mime_type: mime, file_size: blob.size, duration_seconds: seconds });
          if (attachmentError) throw attachmentError;
        } catch (e) { setError(e instanceof Error ? e.message : "Voice upload failed."); }
        finally { setUploading(false); }
      };
      recorderRef.current = recorder; recorderStreamRef.current = stream; setRecordSeconds(0); setRecording(true);
      recorder.start(); recordTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Microphone permission was denied."); }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    recorderRef.current.stop(); recorderRef.current = null; setRecording(false);
    if (recordTimer.current) { clearInterval(recordTimer.current); recordTimer.current = null; }
  }

  async function openAttachment(attachment: Attachment) {
    try {
      if (!selected?.e2ee_public_key) throw new Error("Secure media key unavailable.");
      const encrypted = await fetch(await getSignedUrl(attachment.storage_path)).then(r => r.blob());
      const blob = await decryptBlob(encrypted, selected.e2ee_public_key);
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open file."); }
  }

  async function renderAttachment(attachment: Attachment) {
    try {
      const url = await getSignedUrl(attachment.storage_path);
      if (attachment.mime_type.startsWith("image/")) return <img src={url} alt={attachment.file_name} className="message-image" />;
      if (attachment.mime_type.startsWith("video/")) return <video src={url} controls playsInline className="message-video" />;
      if (attachment.mime_type.startsWith("audio/")) return <AudioMessage src={url} duration={attachment.duration_seconds} />;
      return <button className="file-card" onClick={() => void openAttachment(attachment)}><FileText size={24}/><span><strong>{attachment.file_name}</strong><small>{formatSize(attachment.file_size)} · Open</small></span></button>;
    } catch { return <div className="file-card"><FileText size={24}/><span><strong>{attachment.file_name}</strong><small>Unable to load preview</small></span></div>; }
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <div className="auth-brand" style={{margin:0}}><span className="auth-logo"><MessageCircle size={21}/></span><div><strong>ConnectChat</strong><span>Private chats</span></div></div>
          <button className="icon-button" title="Rotate encryption key" onClick={() => void rotateMyEncryptionKey()}><UserRound size={19}/></button>
        </div>
        <div className="search-box"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people by name, username or phone"/></div>
        <div className="people-list">
          {filteredPeople.map((person) => <button key={person.id} className={`person-row ${selected?.id === person.id ? "active" : ""}`} onClick={() => void openChat(person)}>
            <span className="person-avatar">{person.full_name.slice(0,1).toUpperCase()}</span><span className="person-info"><strong>{person.full_name}</strong><small>{person.username ? `@${person.username}` : person.phone}</small></span>
            <span className={`presence ${person.id === selected?.id ? (otherOnline ? "online" : "") : (person.is_online ? "online" : "")}`}/>
          </button>)}
          {!filteredPeople.length && <p className="empty-state">No other users yet.</p>}
        </div>
      </aside>
      <section className="chat-panel">
        {!selected ? <div className="chat-empty"><MessageCircle size={42}/><h1>Start a private conversation</h1><p>Choose a person from the left to begin messaging in real time.</p></div> : <>
          <header className="chat-header"><span className="person-avatar">{selected.full_name.slice(0,1).toUpperCase()}</span><div><strong>{selected.full_name}</strong><small>{typing ? "typing…" : otherOnline || selected.is_online ? "online" : "offline"}</small></div><div className="chat-call-actions"><button onClick={() => setShowVerification((v) => !v)} title="Verify encryption">🔐</button><button onClick={()=>void startCall("voice")} title="Voice call"><Phone size={18}/></button><button onClick={()=>void startCall("video")} title="Video call"><Video size={18}/></button></div></header>
          {verificationWarning && <div className="e2ee-warning">⚠️ {verificationWarning}</div>}
          {showVerification && <div className="e2ee-verification">
            <div><strong>Encryption verification</strong><button onClick={() => setShowVerification(false)}><X size={14}/></button></div>
            <p>Compare this fingerprint with your contact through a trusted channel. Only mark a device verified when it matches.</p>
            {contactDevices.length ? contactDevices.map((device) => {
              const trusted = trustedDevices.find((item) => item.device_id === device.id && item.fingerprint === device.fingerprint);
              return <div key={device.id} className="e2ee-device">
                <div><strong>{device.device_name}</strong><small>{trusted ? "✓ Verified" : "Not verified"}</small></div>
                <code>{device.fingerprint}</code>
                {!trusted && <button onClick={async () => {
                  try {
                    const saved = await trustE2EEDevice(selected.id, device.id, device.fingerprint);
                    setTrustedDevices((current) => [...current.filter((item) => item.device_id !== device.id), saved]);
                    setVerificationWarning("");
                  } catch (e) { setError(e instanceof Error ? e.message : "Could not verify device."); }
                }}>Mark verified</button>}
              </div>;
            }) : <p>No active encryption devices found.</p>}
          </div>}
          <div className="message-list">
            {messages.map((message) => {
              const mine = message.sender_id === profile?.id;
              return <div key={message.id} className={`message-row ${mine ? "mine" : ""}`}><div className="message-bubble">
                {message.message_type === "sticker" && message.body ? <img src={message.body} alt="Sticker" className="message-sticker" /> : message.body && <div>{message.body}</div>}
                {message.reactions.length > 0 && <div className="reaction-summary">{Object.entries(message.reactions.reduce<Record<string, number>>((a, r) => { a[r.emoji] = (a[r.emoji] ?? 0) + 1; return a; }, {})).map(([emoji, count]) => <button key={emoji} onClick={() => void toggleReaction(message.id, emoji)}>{emoji} {count}</button>)}</div>}
                <div className="reaction-picker"><button title="Like" onClick={() => void toggleReaction(message.id, "👍")}>👍</button><button onClick={() => void toggleReaction(message.id, "❤️")}>❤️</button><button onClick={() => void toggleReaction(message.id, "😂")}>😂</button><button onClick={() => void toggleReaction(message.id, "🔥")}>🔥</button></div>
                {message.attachments.map((attachment) => <AttachmentView key={attachment.id} attachment={attachment} onOpen={openAttachment} getUrl={getSignedUrl} publicKey={selected?.e2ee_public_key ?? null} senderPublicKey={mine ? profile?.e2ee_public_key ?? null : selected?.e2ee_public_key ?? null}/>)}
                <time>{new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</time>
              </div></div>;
            })}
            {!messages.length && <p className="empty-state">No messages yet. Say hello.</p>}
          </div>
          {showEmoji && <div className="emoji-panel">{emojiList.map((emoji) => <button key={emoji} onClick={() => { setDraft((d) => d + emoji); setShowEmoji(false); }}>{emoji}</button>)}</div>}
          {showStickers && <div className="sticker-panel">{stickers.length ? stickers.map((sticker) => <button key={sticker.id} onClick={() => void sendSticker(sticker)}><img src={sticker.image_url} alt={sticker.name}/></button>) : <p>No sticker packs installed yet.</p>}</div>}
          <div className="composer-wrap">
            {recording && <div className="recording-bar"><span className="recording-dot"/> Recording {recordSeconds}s <button onClick={stopRecording}>Send</button></div>}
            <div className="composer">
              <label className="attach-button" title="Attach any file"><Paperclip size={19}/><input type="file" multiple accept="*/*" onChange={(e) => { if (e.target.files) void sendFiles(e.target.files); e.currentTarget.value = ""; }}/></label>
              <label className="attach-button mobile-photo" title="Attach photos or videos"><ImagePlus size={19}/><input type="file" multiple accept="image/*,video/*" onChange={(e) => { if (e.target.files) void sendFiles(e.target.files); e.currentTarget.value = ""; }}/></label>
              <button className="attach-button" title="Emoji" onClick={() => { setShowEmoji((v) => !v); setShowStickers(false); }}><Smile size={19}/></button>
              <button className="attach-button" title="Stickers" onClick={() => { setShowStickers((v) => !v); setShowEmoji(false); }}><Sticker size={19}/></button>
              <button className={`attach-button ${recording ? "recording" : ""}`} onClick={() => recording ? stopRecording() : void startRecording()} title={recording ? "Stop and send" : "Record voice"}>{recording ? <Square size={18}/> : <Mic size={19}/>}</button>
              <input value={draft} onChange={(e) => handleDraftChange(e.target.value)} onKeyDown={(e) => {if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder={uploading ? "Uploading…" : "Write a message…" } disabled={uploading || recording}/>
              <button className="send-button" onClick={() => void sendMessage()} disabled={!draft.trim() || uploading || recording}><Send size={18}/></button>
            </div>
          </div>
        </>}
        {call&&<div className="call-overlay"><div className="call-card"><div className="call-title">{call.incoming?"Incoming":call.status==="ringing"?"Calling":"Call"} {call.type}</div><div className="call-person"><span className="person-avatar">{selected?.full_name.slice(0,1).toUpperCase()??"?"}</span><strong>{selected?.full_name??"ConnectChat user"}</strong><small>{call.status==="ringing"?"Ringing…":Math.floor(callSeconds/60)+":"+String(callSeconds%60).padStart(2,"0")}</small></div>{call.type==="video"&&<div className="video-stage">{remoteStream?<video autoPlay playsInline ref={n=>{if(n)n.srcObject=remoteStream}} className="remote-video"/>:<div className="video-wait">Waiting for camera…</div>}{localStream&&<video autoPlay muted playsInline ref={n=>{if(n)n.srcObject=localStream}} className="local-video"/>}</div>}<div className="call-controls">{call.incoming&&call.status==="ringing"?<><button className="call-action accept" onClick={()=>void acceptCall(call.id,call.type)}>Accept</button><button className="call-action decline" onClick={()=>void endCall("declined")}>Decline</button></>:<><button className="call-action" onClick={()=>{const next=!callMuted;localStream?.getAudioTracks().forEach(t=>{t.enabled=!next});setCallMuted(next)}}>{callMuted?"Unmute":"Mute"}</button>{call.type==="video"&&<button className="call-action" onClick={()=>{const next=!cameraOff;localStream?.getVideoTracks().forEach(t=>{t.enabled=!next});setCameraOff(next)}}>{cameraOff?"Camera on":"Camera off"}</button>}<button className="call-action decline" onClick={()=>void endCall()}>End call</button></>}</div></div></div>}
        {error && <div className="chat-error">{error}<button onClick={() => setError("")}><X size={14}/></button></div>}
      </section>
    </main>
  );
}

function AttachmentView({attachment,onOpen,getUrl,publicKey,senderPublicKey}:{attachment:Attachment;onOpen:(a:Attachment)=>void;getUrl:(path:string)=>Promise<string>;publicKey:string|null;senderPublicKey:string|null}) {
  const [url,setUrl]=useState("");
  useEffect(()=>{
    let alive=true;
    let objectUrl="";
    setUrl("");
    void (async()=>{
      try{
        if(!publicKey) return;
        const encrypted=await fetch(await getUrl(attachment.storage_path)).then(r=>r.blob());
        const plain=await decryptBlob(encrypted, senderPublicKey ?? undefined);
        objectUrl=URL.createObjectURL(new Blob([plain],{type:attachment.mime_type}));
        if(alive) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      }catch{}
    })();
    return()=>{
      alive=false;
      if(objectUrl) URL.revokeObjectURL(objectUrl);
    };
  },[attachment.storage_path,attachment.mime_type,publicKey,senderPublicKey,getUrl]);
  if (!url) return <div className="attachment-loading">Decrypting {attachment.file_name}…</div>;
  if (attachment.mime_type.startsWith("image/")) return <img src={url} alt={attachment.file_name} className="message-image" onClick={()=>onOpen(attachment)}/>;
  if (attachment.mime_type.startsWith("video/")) return <video src={url} controls playsInline className="message-video"/>;
  if (attachment.mime_type.startsWith("audio/")) return <AudioMessage src={url} duration={attachment.duration_seconds}/>;
  return <button className="file-card" onClick={()=>onOpen(attachment)}><FileText size={24}/><span><strong>{attachment.file_name}</strong><small>{formatSize(attachment.file_size)} · Open</small></span></button>;
}
