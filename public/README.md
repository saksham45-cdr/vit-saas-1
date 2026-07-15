# HotelIQ — Redesigned UI (drop-in for `ui/`)

This folder is a drop-in replacement for your existing `ui/` folder
(`index.html`, `style.css`, `chat.js`). It is a **visual layer change only**:

- Same `/api/chat` endpoint, method, headers, and request body (`{ message }`)
- Same response handling (`{ reply, results }`)
- Same `localStorage` chat schema/key (`hiq_chats`, `Chat { id, title, messages, createdAt, updatedAt }`)
- Same DOM ids the JS depends on (`message-input`, `send-button`, `chat-container`, `sidebar`, etc.)
- No changes to any backend file, API route, database schema, or prompt logic

## How to install

1. Back up your current `ui/` folder (or just diff against git).
2. Copy the three files here over `ui/index.html`, `ui/style.css`, `ui/chat.js`.
3. Deploy as usual — nothing else in your Vercel project needs to change.

## What changed visually

- **Design tokens**: deep navy / white / light gray base with royal blue +
  soft emerald accents, Inter typeface, refined shadows and radii. Full
  light/dark theme via `[data-theme]` on `<html>` (persisted in
  `localStorage.hiq_theme`, new key — doesn't touch `hiq_chats`).
- **Sidebar**: same recent-search history and "New search" button, now with
  a desktop collapse toggle (`localStorage.hiq_sidebar_collapsed`) and a
  redesigned mark.
- **Loading**: the old "Searching…" bubble is now a 2-stage progress card
  ("Searching Google & partner sites" → "Extracting facts & preparing your
  report"). This is cosmetic pacing only — the actual network request is
  unchanged, and the UI still waits for the real response before showing
  results or an error.
- **Results**: hotel results now render as premium cards by default (every
  field from the API response is shown: rating, reviews, rooms, family/
  connected-room status, facilities, transit, AI summary). A density toggle
  switches to a refined table for scanning many hotels at once
  (`localStorage.hiq_results_view`). Both views read the exact same
  `results` array — no data is added, removed, or renamed.
- **Export**: a client-side "Export" menu (CSV / copy as Markdown) was added
  on results messages. This runs entirely in the browser from the already-
  fetched `results` array — no new API calls.
- **Empty & error states**: refreshed empty-state copy/art, and failed
  requests now show a friendly error card with an inline **Retry** button
  that resubmits the same query.
- **Accessibility**: visible focus states, AA-contrast text colors in both
  themes, `aria-label`s on icon-only buttons.

## What did NOT change

- `/api/chat` request/response contract
- `hiq_chats` storage key and shape
- Any file under `src/`, `api/`, `supabase/`, or the pipeline scripts
- Routing, auth, rate limiting, or env vars

## Known limitation of this preview

Opening `index.html` directly (without your Vercel dev server / deployed
`/api/chat` route behind it) will show the new **error + retry** state when
you search, since there's no backend to answer the request — that's
expected outside your project. Once dropped into your app next to the real
`/api/chat` function, everything wires up exactly as before.
