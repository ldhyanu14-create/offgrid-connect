# OffGrid Connect — PWA Starter
Works offline after one initial load. Purely digital (phones/computers), no servers required post-load.

## Features
- Offline caching via Service Worker
- Local storage via IndexedDB
- Send SOS, send messages, inbox/outbox
- Export/Import bundles (base64 text). Use any offline channel to pass them.
- Dedupe + TTL decrement + basic ACK tracking (for direct messages)

## Roadmap (add next)
- QR-based sync (multi-frame)
- SSID beacon helper (generate short hotspot names for SOS)
- PIN/HMAC for integrity; optional encryption for message body

## Quick Start
1. Serve these files once (any static server, e.g. `python -m http.server 8000`).
2. Visit the URL on your phone to **cache** it (watch for "Add to Home Screen").
3. Put phone in airplane mode — the app still works.
4. Use **Export Bundle** to copy outbox to text; **Import Bundle** on another phone to deliver.

## Files
- `index.html` — UI
- `style.css`
- `app.js` — logic + IndexedDB
- `sw.js` — service worker cache
- `manifest.json` — PWA metadata
