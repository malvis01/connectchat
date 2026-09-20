"use client";

import Link from "next/link";
import { MessageCircle, Phone, Video, ShieldCheck } from "lucide-react";

const features = [
  ["Private chats", MessageCircle, "One-to-one messaging with real-time delivery."],
  ["Voice calls", Phone, "Private audio calls designed for mobile networks."],
  ["Video calls", Video, "Simple one-to-one video communication."],
  ["Private by design", ShieldCheck, "No public feed, stories, status or business features in V1."],
] as const;

export default function Home() {
  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24}}>
      <section style={{width:"100%",maxWidth:760}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:10,fontWeight:800,fontSize:28}}>
            <MessageCircle size={32}/> ConnectChat
          </div>
          <p style={{fontSize:16,lineHeight:1.6,color:"#667085",maxWidth:560,margin:"12px auto 0"}}>
            A focused mobile-first communication app for private conversations, media, voice messages, voice calls and video calls.
          </p>
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:24}}>
          <Link href="/auth" style={{background:"#101828",color:"#fff",padding:"12px 18px",borderRadius:12,fontWeight:800}}>Create account / Log in</Link>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
          {features.map(([title,Icon,description])=>(
            <article key={title} style={{background:"#fff",border:"1px solid #eaecf0",borderRadius:18,padding:20,boxShadow:"0 4px 18px rgba(16,24,40,.05)"}}>
              <Icon size={22}/>
              <h2 style={{fontSize:17,margin:"14px 0 7px"}}>{title}</h2>
              <p style={{fontSize:14,lineHeight:1.5,color:"#667085",margin:0}}>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}