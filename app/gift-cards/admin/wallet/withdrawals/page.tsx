"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type RequestRow = { id:string;user_id:string;amount:number;currency:string;status:string;user_note:string|null;admin_note:string|null;created_at:string;bank_name:string;account_name:string;country_code:string;account_number_last4:string };
const box:React.CSSProperties={background:"#fff",border:"1px solid #eaecf0",borderRadius:14,padding:16};
const button:React.CSSProperties={border:0,borderRadius:8,padding:"9px 12px",fontWeight:700,cursor:"pointer"};

export default function AdminWithdrawalsPage(){
 const [rows,setRows]=useState<RequestRow[]>([]);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [issuedCodes,setIssuedCodes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const load=useCallback(async()=>{
  setError("");
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError){setError(authError.message);return;}
  if(!user){window.location.href="/auth";return;}
  const {data,error:rpcError}=await supabase.rpc("virtual_wallet_admin_withdrawals");
  if(rpcError){setError(rpcError.message);return;}
  setRows((data??[]) as RequestRow[]);
 },[]);
 useEffect(()=>{void load();},[load]);

 async function issueCode(row:RequestRow){
  setBusy(row.id);setError("");setNotice("");
  try{
   const response=await fetch("/api/admin/wallet/issue-code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({withdrawal_id:row.id})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Could not issue code.");
   setIssuedCodes(current=>({...current,[row.id]:result.code}));
   setNotice("One-time code created. Share it only with the verified user through official support; it expires in 15 minutes and is limited to five attempts.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Could not issue verification code.");}
  finally{setBusy("");}
 }

 async function review(row:RequestRow,status:"rejected"|"processing"|"completed"){
  setBusy(row.id);setError("");setNotice("");
  try{
   const note=(notes[row.id]??"").trim();
   if(note.length<5)throw new Error("Enter a review note of at least 5 characters.");
   const {error:e}=await supabase.rpc("virtual_wallet_admin_review_withdrawal",{p_withdrawal_id:row.id,p_status:status,p_admin_note:note});
   if(e)throw e;
   setNotice("Withdrawal status updated. This only records the workflow status; it does not transfer money.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Could not update withdrawal.");}
  finally{setBusy("");}
 }

 return <main style={{minHeight:"100vh",background:"#f8fafc",color:"#101828",padding:"22px 16px 48px"}}><div style={{maxWidth:1050,margin:"0 auto"}}>
  <Link href="/gift-cards/admin/wallet" style={{display:"inline-flex",gap:8,alignItems:"center",color:"#475467",textDecoration:"none",marginBottom:18}}><ArrowLeft size={17}/> Virtual wallet controls</Link>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:18}}><div><h1 style={{margin:0,fontSize:28}}>Withdrawal review</h1><p style={{color:"#667085",margin:"5px 0 0"}}>Issue one-time support codes and review request status.</p></div><button onClick={()=>void load()} style={{...button,background:"#fff",border:"1px solid #d0d5dd",display:"inline-flex",alignItems:"center",gap:6}}><RefreshCw size={15}/> Refresh</button></header>
  <section style={{...box,background:"#fffaeb",borderColor:"#fedf89",marginBottom:14}}><strong>Real-money safeguard</strong><p style={{margin:"5px 0 0",color:"#7a2e0e",lineHeight:1.5}}>A verified code only moves a request to the review queue. Marking a request completed does not send funds. Do not promise or mark a real payout complete unless an actual transfer is confirmed through a funded, integrated payout provider.</p></section>
  {error&&<p role="alert" style={{background:"#fef3f2",color:"#b42318",padding:12,borderRadius:9}}>{error}</p>}
  {notice&&<p role="status" style={{background:"#ecfdf3",color:"#027a48",padding:12,borderRadius:9}}>{notice}</p>}
  <section style={{display:"grid",gap:12}}>{rows.map(row=><article key={row.id} style={box}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><h2 style={{margin:"0 0 5px",fontSize:18}}>{row.currency} {Number(row.amount).toFixed(2)} · {row.status.replaceAll("_"," ")}</h2><p style={{margin:"0 0 5px",color:"#667085",fontSize:13}}>Request {row.id} · User {row.user_id}</p><p style={{margin:"0 0 5px"}}>{row.bank_name} · {row.account_name} · {row.country_code} · •••• {row.account_number_last4}</p><small style={{color:"#667085"}}>Created {new Date(row.created_at).toLocaleString()}</small>{row.user_note&&<p style={{margin:"8px 0 0"}}>User note: {row.user_note}</p>}{row.admin_note&&<p style={{margin:"5px 0 0"}}>Latest admin note: {row.admin_note}</p>}</div><ShieldCheck size={22} color="#475467"/></div>
   {issuedCodes[row.id]&&<div style={{marginTop:12,padding:12,borderRadius:9,background:"#ecfdf3"}}><strong>One-time code: {issuedCodes[row.id]}</strong><p style={{margin:"4px 0 0",fontSize:13}}>Copy it to the official support conversation only. This code is shown once in this session.</p></div>}
   <label style={{display:"block",marginTop:12}}>Review note<textarea value={notes[row.id]??""} onChange={e=>setNotes(s=>({...s,[row.id]:e.target.value}))} maxLength={500} rows={2} placeholder="Reason for this review action" style={{width:"100%",boxSizing:"border-box",font:"inherit",padding:10,border:"1px solid #d0d5dd",borderRadius:9,marginTop:5}}/></label>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
    {row.status==="pending_verification"&&<button disabled={!!busy} onClick={()=>void issueCode(row)} style={{...button,background:"#eef4ff",color:"#1849a9"}}>Issue support code</button>}
    {row.status==="approved"&&<button disabled={!!busy} onClick={()=>void review(row,"processing")} style={{...button,background:"#eef4ff",color:"#1849a9"}}>Mark processing</button>}
    {row.status==="processing"&&<button disabled={!!busy} onClick={()=>void review(row,"completed")} style={{...button,background:"#ecfdf3",color:"#027a48"}}>Mark completed</button>}
    {["pending_verification","approved","processing"].includes(row.status)&&<button disabled={!!busy} onClick={()=>void review(row,"rejected")} style={{...button,background:"#fef3f2",color:"#b42318"}}>Reject and release hold</button>}
   </div>
  </article>)}{!rows.length&&<section style={box}>No withdrawal requests found, or the admin migration is not applied.</section>}</section>
 </div></main>;
}
