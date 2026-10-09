# ConnectChat Gift Card Marketplace

## Current implementation

- Separate marketplace tables for seller applications, listings, orders, encrypted-delivery records, disputes and audit events.
- Row-level security on every marketplace table.
- Listings are hidden until moderation approves them.
- Seller verification is controlled by marketplace administrator RPCs, not by client-submitted status.
- Order reservation is atomic and idempotent; a listing cannot be reserved twice through the supported RPC.
- Marketplace administration is restricted by the `gift_card_marketplace_admins` table.
- Admin actions for seller verification, listing moderation and dispute resolution are written to `gift_card_audit_events`.
- Never store gift-card codes or PINs in plaintext. The current delivery table accepts ciphertext only; a client-side encryption and delivery workflow still needs implementation.

## Provision the first administrator

1. Have the intended company administrator create a ConnectChat account and sign in.
2. In Supabase SQL Editor, find that user's UUID from `public.profiles` using a verified account identifier.
3. Insert only the verified UUID. Do not expose an admin-provisioning form in the public app:

```sql
insert into public.gift_card_marketplace_admins (user_id)
values ('REPLACE_WITH_VERIFIED_PROFILE_UUID')
on conflict (user_id) do nothing;
```

4. Sign in as that administrator and open `/gift-cards/admin`. The overview RPC must return data only for the provisioned administrator.

## Required before accepting real money

- Select a payment provider whose merchant terms explicitly allow a gift-card resale marketplace and the countries/currencies being served.
- Configure the provider's secret key only as a server-side Supabase Function secret. Never use a secret key in `NEXT_PUBLIC_*` variables or browser code.
- Implement checkout initialization, signed webhook verification, idempotent payment confirmation, refunds, reconciliation, and safe order-state transitions.
- Add provider-supported seller payouts/KYC, settlement timing and dispute handling. Do not promise escrow unless the provider and legal structure support it.
- Implement encrypted seller fulfillment to the buyer's key, buyer access/recovery, receipt confirmation, and a documented dispute window. Never put card credentials in chat or listing descriptions.
- Add terms of service, privacy notice, prohibited-card/region rules, seller identity checks, fraud review, refund policy, support contact, and retention/audit procedures.
- Provision the company administrator and test moderator permissions using non-production accounts.

## Validation

The GitHub Actions workflow `.github/workflows/prelaunch-checks.yml` runs TypeScript validation and the Next.js production build on the pre-launch branch. Passing CI confirms code compilation and build only; it does not replace end-to-end testing of registration, real-time messaging, calls, storage permissions, payment webhooks, or live provider settlement.

## Deployment rule

Do not merge the pre-launch branch or publish a production Netlify deploy until CI is green, end-to-end tests pass, required provider credentials and legal/business controls are configured, and the owner explicitly approves release.
