# Pro Downloader

Production-oriented mobile-first link-based media resolver/downloader application.

## What is included

- Mobile-first single-page frontend
- Light / Dark / System theme
- Downloader UI with dynamic supported-sites list
- URL validation and clipboard helper
- QR scanner modal
- Download task UI
- Link history, watched, bookmarks, favorite sites, tabs
- Tools: Link Checker, Extract Audio, Speed Test, Status Saver
- Firebase Authentication + Realtime Database integration points
- Admin panel with Firebase-backed management
- Secure Node.js/Express backend
- SSRF protection, rate limiting, timeout handling
- PWA manifest + service worker
- Privacy Policy / Terms / Responsible Use
- Database security rules
- Setup, deployment and security documentation

## Important

The project intentionally does **not** invent a universal downloader provider. TeraBox/Instagram/Facebook/TikTok/etc. need a legitimate provider or compliant platform integration configured on the backend. Direct media URLs (`.mp4`, `.webm`, `.mov`, `.m4v`, `.m3u8`) can be inspected by the backend subject to server/network restrictions.

Use the software only for media you own, created, have permission to download, or are otherwise legally entitled to access. The project does not implement DRM or access-control bypass.

## Quick start

```bash
cd backend
npm install
cp .env.example .env
npm run start
```

Open `http://localhost:8080`.

For Firebase, copy the web configuration into `public/assets/js/config.js` or configure it through the generated settings placeholders. See `docs/SETUP.md`.

## Admin bootstrap

1. Create a Firebase user.
2. In Realtime Database, create `/admins/{uid}: true`.
3. Sign in through `admin.html`.
4. Move to custom claims for production if using a backend admin service.

Client checks are only for UX. Realtime Database rules enforce authorization.
