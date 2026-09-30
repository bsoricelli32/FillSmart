# Pumpline v1

A phone web app (PWA) for local gas prices, pump-photo scans, fuel spend, and MPG. Invite only.

## What's already live

**Supabase project "Pumpline"** (`kvunlfjsdqrmafmilvrs`, free plan, us-west-1)

- **Database:** `vehicles`, `fillups`, `user_prefs`, `price_reports`, `station_cache`, `allowlist`
- **Security:** row-level security on every table. Only emails on `allowlist` can sign up (currently just `bsoricelli32@gmail.com`).
- **Storage:** private `pump-photos` bucket; each user can only reach their own folder.
- **Server functions:**
  - `scan-pump` reads a pump photo with Claude Haiku and returns sale, gallons, and price per gallon.
  - `nearby-prices` pulls gas stations and fuel prices from the Google Places API. It caches them for 45 minutes, merges in driver reports (newest price wins), and saves price history for the Outlook screen.

## Steps left (about 20 minutes)

### 1. Add the two API keys

Go to Supabase dashboard, then Edge Functions, then Secrets:
https://supabase.com/dashboard/project/kvunlfjsdqrmafmilvrs/functions/secrets

| Name | Where to get it | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com, API Keys | Scan asks you to type the numbers |
| `GOOGLE_MAPS_API_KEY` | Google Cloud console: enable **Places API (New)**, create a key, restrict it to Places API (New) | Only prices you and your invites report show up |

Check Google's current Places pricing before turning it on. Fuel prices are an Enterprise-tier field. The 45-minute cache keeps calls low, but set a budget alert in Google Cloud.

### 2. Deploy the app

1. Create a GitHub repo (for example `bsoricelli32/pumpline`) and push this folder.
2. On vercel.com: **Add New Project**, then import the repo. Vercel detects Vite automatically.
3. Add the two variables from `.env` under **Environment Variables**, then deploy.

Netlify also works: `public/_redirects` is included.

### 3. Point sign-up emails at your site

Supabase dashboard, then Authentication, then URL Configuration:
set **Site URL** to your Vercel URL (for example `https://pumpline.vercel.app`).

### 4. Install on your iPhone

1. Open the Vercel URL in Safari.
2. Tap **Create account** and use your invited email.
3. Tap the confirm link in the email, then sign in.
4. Tap Share, then **Add to Home Screen**.

### 5. Invite someone

Run this in the Supabase SQL editor, then send them the link:
```sql
insert into public.allowlist (email) values ('friend@example.com');
```

## Run locally

```bash
npm install
npm run dev
```

## Notes

- **Paused projects:** free Supabase projects pause after about a week with no use. Open the app now and then, or restore the project from the dashboard.
- **Photos:** a scanned photo is shrunk to about 1400px before upload.
- **Cost:** each scan costs a fraction of a cent on Haiku.
- **Notifications:** alert switches save your choice. Push alerts are not built yet.
- **Outlook forecast:** it needs at least 4 days of prices near you. It is a simple trend line, not a guarantee.
- **Function source:** `supabase/functions/` has the source for both server functions. Each folder is self-contained so it deploys as-is.
