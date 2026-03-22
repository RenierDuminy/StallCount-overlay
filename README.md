Overlay Control Room
====================

This folder hosts the overlay configuration page and the overlay HTML used for OBS Browser sources.
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

Vercel
------
- Framework preset: Vite
- Build command: npm run build
- Output directory: dist
- No custom rewrites are required

Environment variables
---------------------
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...

Overlay URLs
------------
- Control page: https://overlay.yourdomain.com/
- Overlay output: https://overlay.yourdomain.com/overlay-wfdf-competitive.html?matchId=<match-id>

Optional query params on the control page:
- ?matchId=<match-id> to prefill the match ID
- ?overlay=<overlay-file> to preselect a custom overlay file

Notes
-----
- The Vercel project must define `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- For public overlays, your Supabase RLS should allow SELECT for matches that are marked public.
- Realtime uses Supabase Realtime on the matches table for the given match ID.
