const PREFIX_V1 = "CC-MEDIA-E2EE-1:";
const PREFIX_V2 = "CC-MEDIA-E2EE-2:";

const b64 = (b: Uint8Array) => { let s = ""; b.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveMediaKey(privateKey: CryptoKey, publicKey: string) {
  const publicCryptoKey = await crypto.subtle.importKey("raw", bytes(publicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicCryptoKey }, privateKey, 256);
  const label = "ConnectChat media E2EE v2";
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(label), info: new TextEncoder().encode("direct-media") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function publicKeyFromJwk(jwk: JsonWebKey) {
  const decode = (value: string) => bytes(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4));
  return b64(new Uint8Array([4, ...decode(jwk.x as string), ...decode(jwk.y as string)]));
}

export async function encryptFile(file: File, recipientPublicKey: string) {
  const { ensureE2EEKeypair } = await import("@/lib/e2ee");
  const { privateKey, publicKey: senderPublicKey } = await ensureE2EEKeypair();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveMediaKey(privateKey, recipientPublicKey);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer());
  const header = {
    v: 2,
    sender: senderPublicKey,
    recipient: recipientPublicKey,
    iv: b64(iv),
  };
  return new Blob([new TextEncoder().encode(PREFIX_V2 + JSON.stringify(header) + "\n"), data], { type: "application/octet-stream" });
}

export async function decryptBlob(blob: Blob, senderPublicKey?: string) {
  const ab = await blob.arrayBuffer();
  const u = new Uint8Array(ab);
  const nl = u.indexOf(10);
  if (nl < 0) throw new Error("Invalid encrypted media");
  const header = new TextDecoder().decode(u.slice(0, nl));

  if (header.startsWith(PREFIX_V1)) {
    if (!senderPublicKey) throw new Error("Sender key is required for legacy media.");
    const { deriveSharedKey } = await import("@/lib/e2ee");
    const key = await deriveSharedKey(senderPublicKey);
    const iv = bytes(header.slice(PREFIX_V1.length));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, u.slice(nl + 1));
    return new Blob([plain]);
  }

  if (!header.startsWith(PREFIX_V2)) throw new Error("Invalid encrypted media");
  const envelope = JSON.parse(header.slice(PREFIX_V2.length)) as { v: 2; sender: string; recipient: string; iv: string };
  const { getStoredE2EEKeys } = await import("@/lib/e2ee");
  const keys = await getStoredE2EEKeys();

  for (const stored of [...keys].reverse()) {
    if (stored.publicKey !== envelope.recipient) continue;
    const privateKey = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const key = await deriveMediaKey(privateKey, envelope.sender);
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(envelope.iv) }, key, u.slice(nl + 1));
      return new Blob([plain]);
    } catch { /* try another retained key */ }
  }

  throw new Error("No matching E2EE key is available for this media.");
}
