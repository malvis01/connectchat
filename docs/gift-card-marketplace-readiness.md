# ConnectChat gift-card marketplace readiness

## Current release gate

- Keep the marketplace in reservation/demo mode. Do not deploy or accept live funds until all release gates below are met.
- Platform commission remains **5% of the listing asking price**. It is an estimate at reservation time and is earned only after successful fulfillment.
- Stripe is **not enabled** by this change. Stripe's published restricted-business policy currently lists gift cards/stored-value products and third-party payment facilitation as restricted/prohibited categories. Obtain explicit written approval for this precise marketplace and verify the platform's business-country eligibility before enabling Stripe.
- Do not use a different Stripe account country or business description to bypass eligibility. Stripe country availability and seller payout availability are separate checks.

## Buyer and seller flow

1. Buyer signs in and sees only active listings from the marketplace.
2. Seller registration starts in `pending`; a moderator must verify the seller.
3. Listings start in `pending_review`; a moderator must activate them.
4. The database order RPC rejects unverified sellers and self-purchases, locks the listing, returns an existing live reservation on retry, and sets a 20-minute unpaid reservation expiry.
5. A trusted scheduled call to `POST /api/gift-cards/expire-reservations` releases only expired unpaid reservations. Configure `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in server-side environment variables and call it at least once per minute. The service-role key must never use a `NEXT_PUBLIC_` prefix.
6. The checkout remains disabled until the provider approves this business model and a signed, idempotent payment webhook is implemented and tested.

## Delivery, refunds and payouts

- The database allows buyer access to an encrypted delivery only after order status is `fulfilled`; the seller's access is limited to paid/fulfillment states. Client-side direct writes to delivery payloads remain disabled.
- Never store card numbers/PINs in listing descriptions or plaintext database fields. A production delivery flow still needs reviewed client-side encryption, key exchange/recovery, and a tested release action before the payload can be submitted.
- Refund requests and payout rows are server-only records for workflow/audit. They do **not** execute refunds or transfer money. Provider approval, verified payment state transitions, refund API integration, seller onboarding/eligibility, payout API integration, reconciliation and dispute handling remain release blockers.
- Do not mark commission as earned before fulfillment. Refunds, chargebacks and reversals must be reconciled against provider events before any payout is released.

## Required verification before launch

- Apply migrations to a disposable/test Supabase project first, then verify the functions and RLS policies.
- Test concurrent buyers cannot reserve one listing; retrying one buyer's reservation returns one order; expired unpaid reservations reopen; paid/disputed orders never expire; unverified sellers and self-purchases are rejected.
- Test webhook signature failures, duplicate/replayed events, mismatched amount/currency/order metadata, delayed payment success after expiry, refunds, chargebacks and payout reconciliation.
- Test buyer/seller/admin login and authorization with real test accounts. Provision admin membership only through a trusted server/database process.
- Run TypeScript, production build, migration tests, and browser end-to-end tests. A previous build pass does not verify payment or money movement.
