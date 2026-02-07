Overlay App (Groundwork)
========================

This folder is a standalone scoreboard overlay app meant for OBS Browser sources.
It lives inside the main repo for now so you can deploy it as a separate Vercel project.
Later, you can move this folder into its own repository with minimal changes.

Quick start
-----------
1) Install deps
   npm install

2) Run locally
   npm run dev

3) Build for Vercel
   npm run build

Environment variables
---------------------
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...

Routing
-------
Pass the match id via the URL:
- https://overlay.yourdomain.com/<match-id>
- https://overlay.yourdomain.com/?matchId=<match-id>

Notes
-----
- For public overlays, your Supabase RLS should allow SELECT for matches that are marked public.
- Realtime uses Supabase Realtime on the matches table for the given match id.
