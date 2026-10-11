import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Invoke from a trusted scheduler with Authorization: Bearer <CRON_SECRET>.
// Never expose the Supabase service-role key to a browser.
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Reservation expiry is not configured on the server." },
      { status: 503 },
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("expire_gift_card_reservations");
  if (error) {
    console.error("Reservation expiry failed:", error.message);
    return NextResponse.json({ error: "Could not expire reservations." }, { status: 500 });
  }

  return NextResponse.json({ expiredReservations: data ?? 0 });
}
