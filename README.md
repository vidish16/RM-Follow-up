# Follow-up Funnel

A lead follow-up tracker for RMs, with two access levels:
- **Admin** — sees every RM's follow-ups, a funnel chart, and a per-RM breakdown
- **RM** — sees and manages only their own follow-ups

Real accounts, real passwords, real database — powered by [Supabase](https://supabase.com) (free tier is enough for this).

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up → **New project**.
2. Pick a name, a database password (save it somewhere), and a region close to you.
3. Wait ~2 minutes for it to spin up.

## 2. Create the database tables

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Paste in the entire contents of `supabase/schema.sql` from this project.
3. Click **Run**.

This creates two tables (`profiles`, `followups`) and the security rules that make sure an RM can only see their own rows, while an Admin can see everything.

## 3. Create your first Admin login

1. Dashboard → **Authentication** → **Users** → **Add user**.
2. Enter your email + a password. Tick **Auto Confirm User**.
3. Copy the new user's **UUID** from the users list.
4. Back in **SQL Editor**, run (replacing the UUID and name):

```sql
insert into profiles (id, full_name, role)
values ('paste-the-uuid-here', 'Your Name', 'admin');
```

That's your Admin login. RM logins are created later from inside the app itself — you won't need to touch SQL for those.

## 4. Get your API keys

Dashboard → **Project Settings** → **API**. You'll need:
- **Project URL**
- **anon public** key
- **service_role** key (keep this one secret — never share it or put it in frontend code)

## 5. Run it locally

```bash
cd rm-followup-funnel
npm install
cp .env.example .env
```

Open `.env` and paste in the three values from step 4 (fill in both `VITE_SUPABASE_URL` and `SUPABASE_URL` with the same Project URL).

```bash
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`) and log in with the Admin account from step 3.

> Note: the `/api` functions (used for creating RM logins and resetting passwords) only run on Vercel, not on `npm run dev`. To test those locally, use `npx vercel dev` instead of `npm run dev` (see step 6 for installing the Vercel CLI).

## 6. Deploy it so your team can use it

The easiest way is **Vercel** (free tier, and it auto-detects the `/api` folder as serverless functions).

1. Push this project to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import that repo.
3. Under **Environment Variables**, add the same three values from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**.

You'll get a live URL (e.g. `https://rm-followup-funnel.vercel.app`) that your Admin and RMs can open from any phone or laptop.

## 7. Day-to-day use

- **Admin** logs in → **Manage RM logins** panel → **Add / Reset** → enter the RM's name, email, and a temporary password → **Create RM**. Share that email + temp password with the RM directly (Slack, WhatsApp, whatever you use).
- **RM** logs in with those credentials → can add/edit their own follow-ups, and can change their own password any time from the **Change my password** panel in their view.
- **Admin** can reset any RM's password later from the same **Manage RM logins** panel, if they forget it.

## Project structure

```
rm-followup-funnel/
├── supabase/schema.sql       ← run once in Supabase SQL Editor
├── src/
│   ├── App.jsx               ← the whole app (login, RM view, Admin view)
│   ├── supabaseClient.js
│   └── main.jsx
├── api/
│   ├── create-rm.js           ← admin-only: creates an RM login
│   ├── reset-rm-password.js   ← admin-only: resets an RM's password
│   └── _requireAdmin.js       ← shared auth check for the two above
├── .env.example
└── package.json
```
