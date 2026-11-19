# ConnectChat Supabase foundation

This directory contains the database contract for ConnectChat. It is intentionally separate from every existing Supabase project.

## Authentication

New users register with their **phone number + password** (no OTP or SMS). ConnectChat then issues a permanent public account number in the form `CC-10000001`. That ConnectChat number is what users share with contacts and use with their password to log in again. The original phone number is retained as private account data; phone-number login remains a compatibility alias.

The current implementation maps ConnectChat numbers to internal synthetic email identifiers for Supabase Auth. Enable the **Email** password provider in the dedicated Supabase project. The signup Edge Function creates confirmed synthetic-email users, so no confirmation email or OTP is sent. Do not expose the synthetic email address in the UI.

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
