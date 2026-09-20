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
