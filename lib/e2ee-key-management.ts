import { supabase } from "@/lib/supabase-browser";
import { ensureE2EEKeypair, rotateE2EEKeypair } from "@/lib/e2ee";

const DEVICE_STORAGE = "connectchat:e2ee:device";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintPublicKey(publicKey: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKey));
  const hex = bytesToHex(new Uint8Array(digest));
  return hex.match(/.{1,4}/g)?.join(":") ?? hex;
}

export async function rotateAndRegisterE2EEDevice(userId: string) {
  const keys = await rotateE2EEKeypair();
  const fingerprint = await fingerprintPublicKey(keys.publicKey);
  const stored = localStorage.getItem(DEVICE_STORAGE);
  const deviceName = stored || (navigator.userAgent.includes("Android") ? "Android browser" : "Browser");
  const { data, error } = await supabase.from("e2ee_devices").upsert({
    user_id: userId, device_name: deviceName, public_key: keys.publicKey, fingerprint,
    last_seen_at: new Date().toISOString(), revoked_at: null,
  }, { onConflict: "user_id,public_key" }).select("id,device_name,public_key,fingerprint,created_at,last_seen_at,revoked_at").single();
  if (error) throw error;
  return { ...data, privateKey: keys.privateKey };
}

export async function registerE2EEDevice(userId: string) {
  const keys = await ensureE2EEKeypair();
  const fingerprint = await fingerprintPublicKey(keys.publicKey);
  const stored = localStorage.getItem(DEVICE_STORAGE);
  const deviceName = stored || (navigator.userAgent.includes("Android") ? "Android browser" : "Browser");
  localStorage.setItem(DEVICE_STORAGE, deviceName);

  const { data, error } = await supabase
    .from("e2ee_devices")
    .upsert({
      user_id: userId, device_name: deviceName, public_key: keys.publicKey,
      fingerprint, last_seen_at: new Date().toISOString(), revoked_at: null,
    }, { onConflict: "user_id,public_key" })
    .select("id,device_name,public_key,fingerprint,created_at,last_seen_at,revoked_at")
    .single();
  if (error) throw error;
  return { ...data, privateKey: keys.privateKey };
}

export async function listContactDevices(userId: string) {
  const { data, error } = await supabase
    .from("e2ee_devices")
    .select("id,device_name,public_key,fingerprint,created_at,last_seen_at,revoked_at")
    .eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listTrustedDevices(contactUserId: string) {
  const { data, error } = await supabase
    .from("e2ee_device_trust")
    .select("id,contact_user_id,device_id,fingerprint,verified_at,updated_at")
    .eq("contact_user_id", contactUserId);
  if (error) throw error;
  return data ?? [];
}

export async function trustE2EEDevice(contactUserId: string, deviceId: string, fingerprint: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to verify a device.");
  const { data, error } = await supabase
    .from("e2ee_device_trust")
    .upsert({
      owner_user_id: user.id, contact_user_id: contactUserId, device_id: deviceId, fingerprint,
      verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "owner_user_id,device_id" })
    .select("id,contact_user_id,device_id,fingerprint,verified_at,updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function revokeE2EEDevice(deviceId: string) {
  const { error } = await supabase.from("e2ee_devices")
    .update({ revoked_at: new Date().toISOString() }).eq("id", deviceId);
  if (error) throw error;
}
