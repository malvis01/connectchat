const PREFIX = "CC-E2EE-1:";
const PRIVATE_KEY_STORAGE = "connectchat:e2ee:private";

function bytesToB64(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function b64ToBytes(value: string) {
  const s = atob(value);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function b64urlToBytes(value: string) {
  return b64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4));
}
async function exportPublicKey(key: CryptoKey) {
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}
async function importPublicKey(value: string) {
  return crypto.subtle.importKey("raw", b64ToBytes(value), { name: "ECDH", namedCurve: "P-256" }, false, []);
}
async function deriveKey(privateKey: CryptoKey, publicKeyB64: string) {
  const publicKey = await importPublicKey(publicKeyB64);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("ConnectChat E2EE v1"), info: new TextEncoder().encode("direct-message") },
    await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]),
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("ConnectChat E2EE v1"), info: new TextEncoder().encode("direct-message") },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function ensureE2EEKeypair() {
  const existing = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (existing) {
    const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(existing), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const publicJwk = JSON.parse(existing);
    return { privateKey, publicKey: bytesToB64(new Uint8Array([4, ...b64urlToBytes(publicJwk.x), ...b64urlToBytes(publicJwk.y)])) };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(privateJwk));
  return { privateKey: pair.privateKey, publicKey: await exportPublicKey(pair.publicKey) };
}

export async function encryptText(plain: string, recipientPublicKey: string) {
  const { privateKey } = await ensureE2EEKeypair();
  const key = await deriveKey(privateKey, recipientPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return PREFIX + bytesToB64(iv) + "." + bytesToB64(new Uint8Array(data));
}

export async function decryptText(value: string, senderPublicKey: string) {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, dataB64] = value.slice(PREFIX.length).split(".");
  const { privateKey } = await ensureE2EEKeypair();
  const key = await deriveKey(privateKey, senderPublicKey);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(dataB64));
  return new TextDecoder().decode(plain);
}
