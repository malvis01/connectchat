# ConnectChat Supabase foundation

This directory contains the database contract for ConnectChat. It is intentionally separate from every existing Supabase project.

## Authentication

ConnectChat uses Supabase Auth with **phone number + password**. SMS confirmation is intentionally disabled for the V1 flow, so ConnectChat does not require Twilio or another SMS provider.

The production Supabase project must have:
- Phone provider enabled
- Phone confirmations disabled
- Password sign-in enabled

Users should enter phone numbers in E.164 format, for example `+2348012345678`.

## Database

Apply `schema.sql` to the dedicated ConnectChat Supabase project when one is provisioned. The schema enables RLS for all exposed application tables.

Do not put ConnectChat tables into the existing Where Talent Meets Film or malvis01's Project databases.

## Local development

When the Supabase CLI is available, run the local Supabase stack and use the local URL/key in `.env.local`. No hosted Supabase project is required for initial development.

## Security

Never put a service-role/secret key in browser code or commit it to GitHub.


## ConnectChat account numbers and device keys

Apply migrations in timestamp order. The identity migration adds a stable `CC-########` number to every profile, migrates existing synthetic Auth emails while retaining password hashes, and creates the E2EE device and trust tables. Existing phone input remains a compatibility alias for login; newly issued ConnectChat numbers are the primary login ID.

Deploy both Edge Functions after applying the migration:

```sh
supabase functions deploy create-phone-account --no-verify-jwt
supabase functions deploy login-connectchat-account --no-verify-jwt
```

The signup flow intentionally does not send an OTP. This means ConnectChat cannot confirm that a registrant controls the phone number they enter. The issued ConnectChat number is the account's public handle and should be shared for contact discovery; the original phone number remains private account data and should not be displayed as the public handle.

The service-role key must remain an Edge Function secret and must never be exposed to the browser. Configure the Edge Function secrets using the Supabase project dashboard or CLI. Enable email/password Auth because the current implementation maps ConnectChat numbers to internal synthetic Auth email identifiers.
