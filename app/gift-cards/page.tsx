"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, CreditCard, PlusCircle, RefreshCw, ShieldCheck, ShoppingBag } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

type Listing = {
  id: string; seller_id: string; brand: string; country_code: string; currency: string;
  denomination: number; asking_price: number; card_type: "digital" | "physical";
  description: string; status: string; created_at: string;
};
type Order = {
  id: string; listing_id: string; buyer_id: string; seller_id: string; currency: string;
  amount: number; status: string; created_at: string;
};
type SellerProfile = { user_id: string; business_name: string; country_code: string; verification_status: string };

const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "12px 13px", border: "1px solid #d0d5dd", borderRadius: 10, font: "inherit", background: "#fff", color: "#101828" };
const buttonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 15px", border: 0, borderRadius: 10, background: "#101828", color: "#fff", fontWeight: 700, cursor: "pointer" };
const panelStyle: React.CSSProperties = { background: "#fff", border: "1px solid #eaecf0", borderRadius: 16, padding: 18, boxShadow: "0 4px 14px rgba(16,24,40,.04)" };

export default function GiftCardsPage() {
  const [userId, setUserId] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<Record<string, SellerProfile>>({});
  const [tab, setTab] = useState<"browse" | "sell" | "orders">("browse");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [sellerCountry, setSellerCountry] = useState("NG");
  const [contactEmail, setContactEmail] = useState("");
  const [brand, setBrand] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [currency, setCurrency] = useState("USD");
  const [denomination, setDenomination] = useState("100");
  const [askingPrice, setAskingPrice] = useState("85");
  const [cardType, setCardType] = useState<"digital" | "physical">("digital");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) { window.location.href = "/auth"; return; }
      setUserId(user.id);
      const [listingResult, orderResult] = await Promise.all([
        supabase.from("gift_card_listings").select("id,seller_id,brand,country_code,currency,denomination,asking_price,card_type,description,status,created_at").in("status", ["active", "reserved"]).order("created_at", { ascending: false }),
        supabase.from("gift_card_orders").select("id,listing_id,buyer_id,seller_id,currency,amount,status,created_at").order("created_at", { ascending: false }).limit(100),
      ]);
      if (listingResult.error) throw listingResult.error;
      if (orderResult.error) throw orderResult.error;
      setListings((listingResult.data ?? []) as Listing[]);
      setOrders((orderResult.data ?? []) as Order[]);
      const sellerIds = [...new Set((listingResult.data ?? []).map((x) => x.seller_id))];
      if (sellerIds.length) {
        const { data, error: sellerError } = await supabase.from("gift_card_seller_profiles").select("user_id,business_name,country_code,verification_status").in("user_id", sellerIds);
        if (sellerError) throw sellerError;
        setSellerProfiles(Object.fromEntries((data ?? []).map((x) => [x.user_id, x as SellerProfile])));
      } else setSellerProfiles({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the gift card marketplace.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function registerSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(""); setError("");
    try {
      if (!userId) throw new Error("Sign in before registering as a seller.");
      const { error: saveError } = await supabase.from("gift_card_seller_profiles").insert({
        user_id: userId, business_name: businessName.trim(), country_code: sellerCountry.toUpperCase(),
        contact_email: contactEmail.trim() || null, verification_status: "pending",
      });
      if (saveError) throw saveError;
      setNotice("Seller application saved. Your account is pending verification; listings will require marketplace review before buyers can see them.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit seller application."); }
    finally { setBusy(false); }
  }

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(""); setError("");
    try {
      if (!userId) throw new Error("Sign in before creating a listing.");
      if (!brand.trim() || !description.trim()) throw new Error("Enter the gift card brand and a clear description.");
      const faceValue = Number(denomination), price = Number(askingPrice);
      if (!Number.isFinite(faceValue) || !Number.isFinite(price) || faceValue <= 0 || price <= 0 || price > faceValue) throw new Error("Price must be positive and no higher than the card's face value.");
      const { error: insertError } = await supabase.from("gift_card_listings").insert({
        seller_id: userId, brand: brand.trim(), country_code: countryCode.toUpperCase(),
        currency: currency.toUpperCase(), denomination: faceValue, asking_price: price,
        card_type: cardType, description: description.trim(), status: "pending_review",
      });
      if (insertError) throw insertError;
      setBrand(""); setDescription("");
      setNotice("Listing submitted for review. It will not appear in the public marketplace until an authorized moderator activates it.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the listing."); }
    finally { setBusy(false); }
  }

  async function placeOrder(listing: Listing) {
    setBusy(true); setNotice(""); setError("");
    try {
      if (!userId) throw new Error("Sign in before placing an order.");
      if (listing.seller_id === userId) throw new Error("You cannot buy your own listing.");
      const { data, error: orderError } = await supabase.rpc("create_gift_card_order", { p_listing_id: listing.id });
      if (orderError) throw orderError;
      setNotice("Order reservation created. It is awaiting a verified payment-provider checkout; no payment has been taken. Do not send money directly to a seller.");
      setTab("orders");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reserve this card."); }
    finally { setBusy(false); }
  }

  const myOrders = orders.filter((o) => o.buyer_id === userId || o.seller_id === userId);
  const myListings = listings.filter((l) => l.seller_id === userId);

  return <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#101828", padding: "22px 16px 48px" }}>
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <Link href="/chat" style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "#475467", textDecoration: "none", marginBottom: 20 }}><ArrowLeft size={17}/> Back to chats</Link>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 14, background: "#e0e7ff" }}><CreditCard size={24}/></span><div><h1 style={{ margin: 0, fontSize: 28 }}>Gift Card Marketplace</h1><p style={{ margin: "5px 0 0", color: "#667085" }}>Buy and list gift cards with moderation and order tracking.</p></div></div>
        </div>
        <button style={{ ...buttonStyle, background: "#fff", color: "#344054", border: "1px solid #d0d5dd" }} onClick={() => void load()}><RefreshCw size={16}/> Refresh</button>
      </header>

      <section style={{ ...panelStyle, display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 18, background: "#fffaeb", borderColor: "#fedf89" }}>
        <ShieldCheck size={22} color="#b54708" style={{ flexShrink: 0, marginTop: 2 }}/>
        <div><strong>Buyer protection status</strong><p style={{ margin: "5px 0 0", color: "#7a2e0e", lineHeight: 1.55 }}>Marketplace listings and order reservations are enabled. Live checkout, payment-webhook verification, seller payouts, and encrypted card delivery must be connected and tested before accepting real payments. Never enter a gift card number or PIN into a listing description.</p></div>
      </section>

      {notice && <p role="status" style={{ padding: 13, borderRadius: 10, background: "#ecfdf3", color: "#027a48" }}>{notice}</p>}
      {error && <p role="alert" style={{ padding: 13, borderRadius: 10, background: "#fef3f2", color: "#b42318" }}>{error}</p>}

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {([["browse","Browse cards"],["sell","Sell a gift card"],["orders","My orders"]] as const).map(([value,label]) => <button key={value} onClick={() => { setTab(value); setNotice(""); setError(""); }} style={{ ...buttonStyle, background: tab === value ? "#101828" : "#fff", color: tab === value ? "#fff" : "#344054", border: tab === value ? 0 : "1px solid #d0d5dd" }}>{label}</button>)}
      </nav>

      {loading ? <div style={panelStyle}>Loading marketplace…</div> : <>
        {tab === "browse" && <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(265px,1fr))", gap: 14 }}>
          {!listings.filter((l) => l.status === "active" && l.seller_id !== userId).length && <div style={{ ...panelStyle, gridColumn: "1 / -1" }}><ShoppingBag size={25}/><h2 style={{ marginBottom: 6 }}>No cards available right now</h2><p style={{ color: "#667085", marginTop: 0 }}>Approved listings will appear here. You can submit a listing from the Sell tab.</p></div>}
          {listings.filter((l) => l.status === "active" && l.seller_id !== userId).map((listing) => {
            const seller = sellerProfiles[listing.seller_id];
            return <article key={listing.id} style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}><span style={{ fontSize: 12, fontWeight: 800, color: "#4338ca", background: "#eef2ff", borderRadius: 7, padding: "5px 8px" }}>{listing.country_code} · {listing.card_type}</span>{seller?.verification_status === "verified" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#027a48" }}><BadgeCheck size={15}/> Verified seller</span>}</div>
              <h2 style={{ fontSize: 20, margin: "14px 0 5px" }}>{listing.brand}</h2>
              <p style={{ color: "#667085", margin: "0 0 14px", minHeight: 42 }}>{listing.description}</p>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", borderTop: "1px solid #eaecf0", paddingTop: 14 }}>
                <div><small style={{ color: "#667085" }}>Face value</small><div style={{ fontWeight: 700 }}>{listing.currency} {Number(listing.denomination).toFixed(2)}</div><small style={{ color: "#667085" }}>Asking price</small><div style={{ fontSize: 21, fontWeight: 800 }}>{listing.currency} {Number(listing.asking_price).toFixed(2)}</div></div>
                <button disabled={busy} style={buttonStyle} onClick={() => void placeOrder(listing)}>{busy ? "Please wait…" : "Reserve card"}</button>
              </div>
            </article>;
          })}
        </section>}

        {tab === "sell" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, alignItems: "start" }}>
          <form onSubmit={registerSeller} style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>Seller verification</h2>
            <p style={{ color: "#667085", lineHeight: 1.5 }}>Register your seller/business details. Verification status is controlled by a moderator, not by this form.</p>
            <label style={{ display: "block", marginBottom: 12 }}>Business or seller name<input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} maxLength={120}/></label>
            <label style={{ display: "block", marginBottom: 12 }}>Country code (ISO, e.g. NG)<input required value={sellerCountry} onChange={(e) => setSellerCountry(e.target.value.toUpperCase())} style={{ ...inputStyle, marginTop: 6 }} minLength={2} maxLength={2} pattern="[A-Z]{2}"/></label>
            <label style={{ display: "block", marginBottom: 16 }}>Contact email (optional)<input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}/></label>
            <button disabled={busy} style={buttonStyle}>{busy ? "Saving…" : "Submit seller application"}</button>
          </form>
          <form onSubmit={createListing} style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>Create a listing</h2>
            <p style={{ color: "#667085", lineHeight: 1.5 }}>Listings enter moderation first. Do not put gift card codes or PINs in any field.</p>
            <label style={{ display: "block", marginBottom: 12 }}>Gift card brand<input required value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Apple, Amazon, Steam" style={{ ...inputStyle, marginTop: 6 }} maxLength={80}/></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "block", marginBottom: 12 }}>Country<input required value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} style={{ ...inputStyle, marginTop: 6 }} minLength={2} maxLength={2} pattern="[A-Z]{2}"/></label>
              <label style={{ display: "block", marginBottom: 12 }}>Currency<input required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} style={{ ...inputStyle, marginTop: 6 }} minLength={3} maxLength={3} pattern="[A-Z]{3}"/></label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "block", marginBottom: 12 }}>Face value<input required type="number" min="0.01" step="0.01" value={denomination} onChange={(e) => setDenomination(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}/></label>
              <label style={{ display: "block", marginBottom: 12 }}>Your price<input required type="number" min="0.01" step="0.01" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}/></label>
            </div>
            <label style={{ display: "block", marginBottom: 12 }}>Card type<select value={cardType} onChange={(e) => setCardType(e.target.value as "digital" | "physical")} style={{ ...inputStyle, marginTop: 6 }}><option value="digital">Digital</option><option value="physical">Physical</option></select></label>
            <label style={{ display: "block", marginBottom: 16 }}>Description<textarea required value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="State region restrictions, expiry, and any important terms. Do not include card codes or PINs." style={{ ...inputStyle, marginTop: 6, resize: "vertical" }}/></label>
            <button disabled={busy} style={buttonStyle}><PlusCircle size={17}/>{busy ? "Submitting…" : "Submit for review"}</button>
          </form>
          <section style={{ ...panelStyle, gridColumn: "1 / -1" }}>
            <h2 style={{ marginTop: 0 }}>Your submitted listings</h2>
            {!myListings.length ? <p style={{ color: "#667085" }}>Your listings will appear here once approved or reserved.</p> : myListings.map((l) => <div key={l.id} style={{ padding: "12px 0", borderTop: "1px solid #eaecf0", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><span><strong>{l.brand}</strong><small style={{ display: "block", color: "#667085" }}>{l.currency} {Number(l.asking_price).toFixed(2)} · {l.country_code}</small></span><span style={{ fontSize: 12, fontWeight: 700, background: "#f2f4f7", padding: "6px 9px", borderRadius: 7 }}>{l.status.replaceAll("_", " ")}</span></div>)}
          </section>
        </div>}

        {tab === "orders" && <section style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>Orders and reservations</h2>
          {!myOrders.length ? <p style={{ color: "#667085" }}>You have no gift card orders yet.</p> : myOrders.map((o) => {
            const listing = listings.find((l) => l.id === o.listing_id);
            return <div key={o.id} style={{ padding: "14px 0", borderTop: "1px solid #eaecf0", display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div><strong>{listing?.brand ?? "Gift card order"}</strong><small style={{ display: "block", color: "#667085", marginTop: 4 }}>{o.buyer_id === userId ? "Buyer order" : "Seller order"} · {new Date(o.created_at).toLocaleString()}</small><small style={{ display: "block", color: "#667085" }}>Order {o.id.slice(0, 8)} · {o.currency} {Number(o.amount).toFixed(2)}</small></div>
              <span style={{ height: "fit-content", fontSize: 12, fontWeight: 700, background: o.status === "fulfilled" ? "#ecfdf3" : "#fffaeb", color: o.status === "fulfilled" ? "#027a48" : "#b54708", padding: "6px 9px", borderRadius: 7 }}>{o.status.replaceAll("_", " ")}</span>
            </div>;
          })}
          <p style={{ color: "#667085", lineHeight: 1.5, marginBottom: 0 }}>Orders stay in awaiting payment until a verified checkout integration confirms payment server-side. Do not transfer money directly to a seller or share gift card credentials in chat.</p>
        </section>}
      </>}
      <footer style={{ marginTop: 28, color: "#98a2b3", fontSize: 12, textAlign: "center" }}>ConnectChat Marketplace · Never share gift card PINs in chat · Report suspected fraud to marketplace support</footer>
    </div>
  </main>;
}
