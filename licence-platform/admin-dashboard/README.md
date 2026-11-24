# Licence Desk (admin dashboard)

React + TypeScript + Vite app on top of the `business-user-app` Supabase project.
Google sign-in only. App owner sees every business; business owners see their own team.

## Run locally
    npm install
    npm run dev        # http://localhost:5173

Settings live in `.env` (copy `.env.example`). Both values are public by design:
the Supabase URL and the publishable key. Never put the service_role key here.

## Deploy
Build output is the `dist` folder (`npm run build`).
- Netlify: drag the `dist` folder onto https://app.netlify.com/drop, or connect the repo (settings are in `netlify.toml`).
- Vercel: import the folder or run `vercel` (settings are in `vercel.json`).

## After deploying (required, or Google sign-in will fail)
1. Supabase dashboard > Authentication > URL Configuration:
   - Site URL = your live address (for example https://licence-desk.netlify.app)
   - Redirect URLs: add the same address, plus `http://localhost:5173` for local work
2. Supabase dashboard > Authentication > Sign In / Providers > Google: enabled, with the Client ID and Secret from Google Cloud.
3. Google Cloud > OAuth client (Web application) > Authorized redirect URI:
   https://qeiqtmxrjcweiysunkww.supabase.co/auth/v1/callback
4. Google Cloud > OAuth consent screen: publish to production, or only listed test users can sign in.
