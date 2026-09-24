const PREFIX="CC-MEDIA-E2EE-1:";
const b64=(b:Uint8Array)=>{let s="";b.forEach(x=>s+=String.fromCharCode(x));return btoa(s)};
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function encryptFile(file:File,key:CryptoKey){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,await file.arrayBuffer());return new Blob([new TextEncoder().encode(PREFIX+b64(iv)+"\n"),data],{type:"application/octet-stream"})}
export async function decryptBlob(blob:Blob,key:CryptoKey){const ab=await blob.arrayBuffer();const u=new Uint8Array(ab);const nl=u.indexOf(10);if(nl<0)throw new Error("Invalid encrypted media");const header=new TextDecoder().decode(u.slice(0,nl));const iv=bytes(header.slice(PREFIX.length));const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,u.slice(nl+1));return new Blob([plain])}
