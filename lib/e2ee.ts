const PREFIX_V1 = "CC-E2EE-1:";
const PREFIX_V2 = "CC-E2EE-2:";
const PRIVATE_KEY_STORAGE = "connectchat:e2ee:private";
const KEYRING_STORAGE = "connectchat:e2ee:keyring";

type StoredKey = { publicKey: string; privateJwk: JsonWebKey; createdAt: string; revokedAt?: string };

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
async function deriveKey(privateKey: CryptoKey, publicKeyB64: string, version = "v2") {
  const publicKey = await importPublicKey(publicKeyB64);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const label = `ConnectChat E2EE ${version}`;
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(label), info: new TextEncoder().encode("direct-message") },
    await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function readKeyring(): StoredKey[] {
  try { return JSON.parse(localStorage.getItem(KEYRING_STORAGE) ?? "[]"); } catch { return []; }
}
function writeKeyring(keys: StoredKey[]) {
  localStorage.setItem(KEYRING_STORAGE, JSON.stringify(keys.slice(-10)));
}

export async function getStoredE2EEKeys() {
  const keys = readKeyring();
  const current = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (current && !keys.some((k) => JSON.stringify(k.privateJwk) === current)) {
    const jwk = JSON.parse(current);
    const publicKey = bytesToB64(new Uint8Array([4, ...b64urlToBytes(jwk.x), ...b64urlToBytes(jwk.y)]));
    keys.push({ publicKey, privateJwk: jwk, createdAt: new Date().toISOString() });
    writeKeyring(keys);
  }
  return readKeyring();
}

export async function ensureE2EEKeypair() {
  const existing = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (existing) {
    const privateKey = await crypto.subtle.importKey("jwk", JSON.parse(existing), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const publicJwk = JSON.parse(existing);
    const publicKey = bytesToB64(new Uint8Array([4, ...b64urlToBytes(publicJwk.x), ...b64urlToBytes(publicJwk.y)]));
    await getStoredE2EEKeys();
    return { privateKey, publicKey };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(privateJwk));
  const publicKey = await exportPublicKey(pair.publicKey);
  writeKeyring([{ publicKey, privateJwk, createdAt: new Date().toISOString() }]);
  return { privateKey: pair.privateKey, publicKey };
}

export async function rotateE2EEKeypair() {
  await ensureE2EEKeypair();
  const current = localStorage.getItem(PRIVATE_KEY_STORAGE);
  if (current) {
    const jwk = JSON.parse(current);
    const publicKey = bytesToB64(new Uint8Array([4, ...b64urlToBytes(jwk.x), ...b64urlToBytes(jwk.y)]));
    const keys = readKeyring().map((k) => k.publicKey === publicKey ? { ...k, revokedAt: new Date().toISOString() } : k);
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const nextPublicKey = await exportPublicKey(pair.publicKey);
    localStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(privateJwk));
    writeKeyring([...keys, { publicKey: nextPublicKey, privateJwk, createdAt: new Date().toISOString() }]);
    return { privateKey: pair.privateKey, publicKey: nextPublicKey };
  }
  return ensureE2EEKeypair();
}

export async function deriveSharedKey(publicKeyB64: string) {
  const { privateKey } = await ensureE2EEKeypair();
  return deriveKey(privateKey, publicKeyB64, "v1");
}

export async function deriveSharedKeyForPublicKey(publicKeyB64: string, privateKey: CryptoKey) {
  return deriveKey(privateKey, publicKeyB64, "v2");
}

export async function encryptText(plain: string, recipientPublicKey: string) {
  const { privateKey, publicKey: senderPublicKey } = await ensureE2EEKeypair();
  const key = await deriveKey(privateKey, recipientPublicKey, "v2");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return PREFIX_V2 + JSON.stringify({
    v: 2,
    sender: senderPublicKey,
    recipient: recipientPublicKey,
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(data)),
  });
}

export async function decryptText(value: string, senderPublicKey: string) {
  if (value.startsWith(PREFIX_V1)) {
    const [ivB64, dataB64] = value.slice(PREFIX_V1.length).split(".");
    const { privateKey } = await ensureE2EEKeypair();
    const key = await deriveKey(privateKey, senderPublicKey, "v1");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(dataB64));
    return new TextDecoder().decode(plain);
  }
  if (!value.startsWith(PREFIX_V2)) return value;
  const envelope = JSON.parse(value.slice(PREFIX_V2.length)) as { sender: string; recipient: string; iv: string; data: string };
  const keys = await getStoredE2EEKeys();
  for (const stored of [...keys].reverse()) {
    if (stored.publicKey !== envelope.recipient) continue;
    const privateKey = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const key = await deriveKey(privateKey, envelope.sender, "v2");
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(envelope.iv) }, key, b64ToBytes(envelope.data));
      return new TextDecoder().decode(plain);
    } catch { /* try another retained key */ }
  }
  throw new Error("No matching E2EE key is available for this message.");
}
