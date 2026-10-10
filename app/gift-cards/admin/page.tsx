"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type AdminListing = { id:string;seller_id:string;brand:string;country_code:string;currency:string;denomination:number;asking_price:number;card_type:string;description:string;status:string;moderation_note:string|null;created_at:string };
type AdminSeller = { user_id:string;business_name:string;country_code:string;contact_email:string|null;verification_status:string;created_at:string };
type AdminDispute = { id:string;order_id:string;opened_by:string;reason:string;details:string;status:string;resolution_note:string|null;created_at:string };
type AdminOrder = { id:string;listing_id:string;buyer_id:string;seller_id:string;currency:string;amount:number;platform_fee:number;status:string;payment_provider:string|null;provider_reference:string|null;created_at:string };
type FinanceRow = {currency:string;completed_sales:number;commission_earned:number;paid_pending_fulfillment:number;refunded_amount:number;awaiting_payment_amount:number};\ntype Overview = { counts:{pending_listings:number;pending_sellers:number;open_disputes:number;orders:number};finance_by_currency:FinanceRow[];listings:AdminListing[];sellers:AdminSeller[];disputes:AdminDispute[];orders:AdminOrder[] };

const panel:React.CSSProperties={background:"#fff",border:"1px solid #eaecf0",borderRadius:15,padding:17};
const action:React.CSSProperties={display:"inline-flex",alignItems:"center",gap:6,border:0,borderRadius:9,padding:"9px 12px",fontWeight:700,cursor:"pointer"};

export default function GiftCardAdminPage(){
 const [overview,setOverview]=useState<Overview|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [tab,setTab]=useState<"listings"|"sellers"|"disputes"|"orders">("listings");

 const load=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const {data:{user},error:authError}=await supabase.auth.getUser();
   if(authError)throw authError;
   if(!user){window.location.href="/gift-cards/admin/login";return;}
   const {data,isError,error:rpcError}=await supabase.rpc("gift_card_admin_overview");
   if(rpcError)throw rpcError;
   setOverview(data as Overview);
  }catch(e){setOverview(null);setError(e instanceof Error?e.message:"Could not load admin console.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);

 async function moderateListing(id:string,status:"active"|"rejected"|"suspended"){
  setBusy(id);setError("");setNotice("");
  try{const {error:e}=await supabase.rpc("gift_card_admin_moderate_listing",{p_listing_id:id,p_status:status,p_note:notes[id]||null});if(e)throw e;setNotice("Listing moderation saved.");await load();}
  catch(e){setError(e instanceof Error?e.message:"Could not moderate listing.");}
  finally{setBusy("");}
 }
 async function setSeller(id:string,status:"verified"|"rejected"|"suspended"|"pending"){
  setBusy(id);setError("");setNotice("");
  try{const {error:e}=await supabase.rpc("gift_card_admin_set_seller",{p_user_id:id,p_status:status});if(e)throw e;setNotice("Seller verification updated.");await load();}
  catch(e){setError(e instanceof Error?e.message:"Could not update seller.");}
  finally{setBusy("");}
 }
 async function resolveDispute(id:string,status:"under_review"|"resolved_buyer"|"resolved_seller"|"closed"){
  setBusy(id);setError("");setNotice("");
  try{const {error:e}=await supabase.rpc("gift_card_admin_resolve_dispute",{p_dispute_id:id,p_status:status,p_note:notes[id]||""});if(e)throw e;setNotice("Dispute status saved.");await load();}
  catch(e){setError(e instanceof Error?e.message:"Could not update dispute.");}
  finally{setBusy("");}
 }

 return <main style={{minHeight:"100vh",background:"#f8fafc",color:"#101828",padding:"22px 16px 50px"}}>
  <div style={{maxWidth:1100,margin:"0 auto"}}>
   <Link href="/gift-cards" style={{display:"inline-flex",alignItems:"center",gap:8,color:"#475467",textDecoration:"none",marginBottom:18}}><ArrowLeft size={17}/> Marketplace</Link>
   <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:20}}>
    <div><h1 style={{margin:0,fontSize:28}}>Marketplace operations</h1><p style={{color:"#667085",margin:"6px 0 0"}}>Seller verification, listing moderation, disputes and order oversight.</p></div>
    <button onClick={()=>void load()} style={{...action,background:"#fff",border:"1px solid #d0d5dd"}}><RefreshCw size={16}/> Refresh</button>
   </header>
   <section style={{...panel,display:"flex",gap:12,alignItems:"start",background:"#fffaeb",borderColor:"#fedf89",marginBottom:18}}>
    <ShieldAlert size={22} color="#b54708"/><div><strong>Restricted administrator area</strong><p style={{margin:"5px 0 0",lineHeight:1.5,color:"#7a2e0e"}}>Only accounts explicitly provisioned in the gift_card_marketplace_admins table can access these operations. Do not add admin privileges through a client form.</p></div>
   </section>
   {notice&&<p role="status" style={{background:"#ecfdf3",color:"#027a48",padding:12,borderRadius:10}}>{notice}</p>}
   {error&&<p role="alert" style={{background:"#fef3f2",color:"#b42318",padding:12,borderRadius:10}}>{error}</p>}
   {loading?<section style={panel}>Loading operations…</section>:overview?<>
    <section style={{...panel,marginBottom:18}}>
     <h2 style={{margin:"0 0 6px",fontSize:19}}>Financial overview</h2>
     <p style={{margin:"0 0 14px",color:"#667085",fontSize:13,lineHeight:1.5}}>The platform fee is set to 5% of the asking price. Commission is counted as earned only for fulfilled orders; pending payment, paid-but-unfulfilled orders and refunds are shown separately. Amounts remain grouped by currency.</p>
     {!overview.finance_by_currency?.length?<p style={{margin:0,color:"#667085"}}>No gift-card orders have been recorded yet.</p>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
      {overview.finance_by_currency.map(f=><div key={f.currency} style={{border:"1px solid #eaecf0",borderRadius:12,padding:13}}>
       <strong style={{fontSize:16}}>{f.currency}</strong>
       <div style={{marginTop:10,fontSize:13,color:"#667085"}}>Completed sales</div><strong>{f.currency} {Number(f.completed_sales).toFixed(2)}</strong>
       <div style={{marginTop:8,fontSize:13,color:"#667085"}}>Commission earned (5%)</div><strong style={{color:"#027a48"}}>{f.currency} {Number(f.commission_earned).toFixed(2)}</strong>
       <div style={{marginTop:8,fontSize:13,color:"#667085"}}>Paid, awaiting fulfillment</div><strong>{f.currency} {Number(f.paid_pending_fulfillment).toFixed(2)}</strong>
       <div style={{marginTop:8,fontSize:13,color:"#667085"}}>Awaiting payment</div><strong>{f.currency} {Number(f.awaiting_payment_amount).toFixed(2)}</strong>
       <div style={{marginTop:8,fontSize:13,color:"#667085"}}>Refunded volume</div><strong>{f.currency} {Number(f.refunded_amount).toFixed(2)}</strong>
      </div>)}
     </div>}
    </section>
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:18}}>
     {([["Pending listings",overview.counts.pending_listings],["Pending sellers",overview.counts.pending_sellers],["Open disputes",overview.counts.open_disputes],["Total orders",overview.counts.orders]] as const).map(([label,value])=><div key={label} style={panel}><div style={{color:"#667085",fontSize:13}}>{label}</div><strong style={{fontSize:28,display:"block",marginTop:8}}>{value}</strong></div>)}
    </section>
    <nav style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:15}}>
     {(["listings","sellers","disputes","orders"] as const).map(t=><button key={t} onClick={()=>setTab(t)} style={{...action,background:tab===t?"#101828":"#fff",color:tab===t?"#fff":"#344054",border:tab===t?0:"1px solid #d0d5dd",textTransform:"capitalize"}}>{t}</button>)}
    </nav>
    {tab==="listings"&&<section style={{display:"grid",gap:12}}>
     {!overview.listings.length&&<div style={panel}>No listings need moderation.</div>}
     {overview.listings.map(l=><article key={l.id} style={panel}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><h2 style={{margin:"0 0 6px",fontSize:18}}>{l.brand} · {l.country_code}</h2><p style={{margin:"0 0 6px",color:"#475467"}}>{l.currency} {Number(l.asking_price).toFixed(2)} ask / {Number(l.denomination).toFixed(2)} face value · {l.card_type}</p><p style={{margin:0,color:"#667085"}}>{l.description}</p><small style={{display:"block",color:"#98a2b3",marginTop:8}}>Seller {l.seller_id} · {l.id}</small></div><span style={{height:"fit-content",background:"#f2f4f7",padding:"6px 9px",borderRadius:8,fontSize:12}}>{l.status.replaceAll("_"," ")}</span></div>
      <textarea value={notes[l.id]??l.moderation_note??""} onChange={e=>setNotes(s=>({...s,[l.id]:e.target.value}))} placeholder="Moderation note (optional)" rows={2} style={{width:"100%",boxSizing:"border-box",margin:"12px 0",padding:10,border:"1px solid #d0d5dd",borderRadius:9,font:"inherit"}}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button disabled={!!busy} onClick={()=>void moderateListing(l.id,"active")} style={{...action,background:"#ecfdf3",color:"#027a48"}}><CheckCircle2 size={15}/> Approve</button><button disabled={!!busy} onClick={()=>void moderateListing(l.id,"rejected")} style={{...action,background:"#fef3f2",color:"#b42318"}}><XCircle size={15}/> Reject</button><button disabled={!!busy} onClick={()=>void moderateListing(l.id,"suspended")} style={{...action,background:"#fffaeb",color:"#b54708"}}><ShieldAlert size={15}/> Suspend</button></div>
     </article>)}
    </section>}
    {tab==="sellers"&&<section style={{display:"grid",gap:12}}>
     {!overview.sellers.length&&<div style={panel}>No seller applications need review.</div>}
     {overview.sellers.map(s=><article key={s.user_id} style={panel}><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><div><h2 style={{margin:"0 0 6px",fontSize:18}}>{s.business_name}</h2><p style={{margin:"0 0 5px",color:"#667085"}}>{s.country_code} · {s.contact_email||"No contact email"}</p><small style={{color:"#98a2b3"}}>Account {s.user_id}</small></div><span>{s.verification_status}</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button disabled={!!busy} onClick={()=>void setSeller(s.user_id,"verified")} style={{...action,background:"#ecfdf3",color:"#027a48"}}><ShieldCheck size={15}/> Verify</button><button disabled={!!busy} onClick={()=>void setSeller(s.user_id,"rejected")} style={{...action,background:"#fef3f2",color:"#b42318"}}>Reject</button><button disabled={!!busy} onClick={()=>void setSeller(s.user_id,"suspended")} style={{...action,background:"#fffaeb",color:"#b54708"}}>Suspend</button></div></article>)}
    </section>}
    {tab==="disputes"&&<section style={{display:"grid",gap:12}}>
     {!overview.disputes.length&&<div style={panel}>No open disputes.</div>}
     {overview.disputes.map(d=><article key={d.id} style={panel}><h2 style={{margin:"0 0 6px",fontSize:18}}>{d.reason}</h2><p style={{color:"#475467",whiteSpace:"pre-wrap"}}>{d.details||"No extra details provided."}</p><small style={{color:"#98a2b3"}}>Dispute {d.id} · Order {d.order_id} · Opened by {d.opened_by}</small><textarea value={notes[d.id]??""} onChange={e=>setNotes(s=>({...s,[d.id]:e.target.value}))} placeholder="Resolution note (required for company records)" rows={2} style={{width:"100%",boxSizing:"border-box",margin:"12px 0",padding:10,border:"1px solid #d0d5dd",borderRadius:9,font:"inherit"}}/><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button disabled={!!busy} onClick={()=>void resolveDispute(d.id,"under_review")} style={{...action,background:"#fffaeb",color:"#b54708"}}>Under review</button><button disabled={!!busy||!(notes[d.id]||"").trim()} onClick={()=>void resolveDispute(d.id,"resolved_buyer")} style={{...action,background:"#ecfdf3",color:"#027a48"}}>Resolve for buyer</button><button disabled={!!busy||!(notes[d.id]||"").trim()} onClick={()=>void resolveDispute(d.id,"resolved_seller")} style={{...action,background:"#eef2ff",color:"#3730a3"}}>Resolve for seller</button><button disabled={!!busy||!(notes[d.id]||"").trim()} onClick={()=>void resolveDispute(d.id,"closed")} style={{...action,background:"#f2f4f7",color:"#344054"}}>Close</button></div></article>)}
    </section>}
    {tab==="orders"&&<section style={{...panel,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}><thead><tr>{["Order","Amount","Status","Payment reference","Created"].map(x=><th key={x} style={{textAlign:"left",padding:"10px 8px",borderBottom:"1px solid #eaecf0",color:"#667085"}}>{x}</th>)}</tr></thead><tbody>{overview.orders.map(o=><tr key={o.id}>{[o.id.slice(0,8),o.currency+" "+Number(o.amount).toFixed(2),o.status,o.provider_reference||"Not paid",new Date(o.created_at).toLocaleString()].map((v,i)=><td key={i} style={{padding:"12px 8px",borderBottom:"1px solid #f2f4f7",fontSize:13}}>{v}</td>)}</tr>)}</tbody></table></section>}
   </>:<section style={panel}><ShieldAlert size={25}/><h2>Admin access unavailable</h2><p style={{color:"#667085",lineHeight:1.6}}>This account is not provisioned as a marketplace administrator, or the admin database functions have not been applied. Ask the project owner to securely provision your user ID in gift_card_marketplace_admins.</p></section>}
   <footer style={{marginTop:24,color:"#98a2b3",fontSize:12,textAlign:"center"}}>Administrative actions are logged. Do not approve sellers or listings without the required checks.</footer>
  </div>
 </main>;
}
