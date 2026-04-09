# Yar

A third-party web frontend for [radiko](https://radiko.jp), Japan's internet radio service.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and hls.js.

## Features

- **Nationwide station access** -- browse and play all radiko stations across Japan, not just your local area
- **Live streaming** -- one-click live radio playback
- **Timefree playback** -- listen to programs from the past 7 days with seek, skip, and progress bar
- **Now-playing song display** -- shows the currently playing song via radiko's Music API, with links to Apple Music and Amazon
- **Station detail page** -- program detail view with description, song list, and a schedule sidebar (desktop) or bottom sheet (mobile)
- **Background playback** -- Media Session API integration for OS-level play/pause/skip controls
- **User preferences** -- volume level, recent stations, and region preferences are remembered via localStorage
- **Personalized home page** -- frequently played stations shown at the top, regions sorted by listening history

## How it works

The app uses Next.js API routes to proxy all radiko API calls (radiko does not provide CORS headers). Authentication uses Android app mode (`aSmartPhone8`) with fake GPS coordinates to bypass regional restrictions, enabling nationwide station access from any location.

Key technical details:

- **Auth**: Two-step auth flow (auth1 → partial key extraction → auth2 with GPS) with per-area token caching (70 min TTL)
- **Streaming**: HLS streams via hls.js. Pause destroys the HLS instance to stop all network requests; resume re-requests from the saved position
- **Timefree seeking**: Re-requests the m3u8 playlist with a `seek` parameter (radiko caps the `l` parameter at 300 seconds, so native HLS seeking doesn't work)
- **Station-to-area mapping**: Built from `region/full.xml`, cached for 1 hour. The frontend never handles areaId -- all resolution is server-side

## Getting started

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

No environment variables are required. The auth key is bundled in the repository.

## Deployment

The project is compatible with multiple deployment targets out of the box.

### Vercel

1. Push to a git repository
2. Import the project on [vercel.com](https://vercel.com)
3. Deploy -- no configuration needed

Vercel's serverless functions handle the API routes natively.

### Cloudflare Workers (via OpenNext)

Next.js can be deployed to Cloudflare Workers using [OpenNext for Cloudflare](https://opennext.js.org/cloudflare):

Before previewing or deploying, create and/or rename the resources referenced by `wrangler.jsonc` so they match your environment.
The checked-in config currently expects:

1. A Worker/service named `yar`
2. An R2 bucket named `yar-opennext-cache`

If you use different names, update `wrangler.jsonc` before running the commands below.

```bash
# Preview locally
npm run preview

# Deploy to Cloudflare
npm run deploy
```

The project already includes `wrangler.jsonc` and `open-next.config.ts`. See the [OpenNext Cloudflare docs](https://opennext.js.org/cloudflare/get-started) for further customization.

### Self-hosted

```bash
npm run build
npm start
```

Runs on port 3000 by default. Use a reverse proxy (nginx, caddy) for HTTPS in production.

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/route.ts        # Radiko auth endpoint
│   │   ├── stations/route.ts    # Nationwide station list
│   │   ├── programs/route.ts    # Program schedule
│   │   ├── noa/route.ts         # Now-on-air songs (Music API)
│   │   └── stream/
│   │       ├── live/route.ts    # Live stream playlist
│   │       ├── timefree/route.ts # Timefree stream playlist
│   │       └── proxy/route.ts   # HLS proxy (rewrites m3u8 URLs)
│   ├── station/[id]/page.tsx    # Station detail page
│   ├── page.tsx                 # Home page (station list)
│   ├── layout.tsx               # Root layout
│   └── globals.css              # Global styles
├── components/
│   ├── PlayerBar.tsx            # Bottom player bar with controls
│   ├── ProgramSchedule.tsx      # Station detail + schedule
│   └── StationList.tsx          # Home page station grid
└── lib/
    ├── player-context.tsx       # Global player state (hls.js, Media Session)
    ├── radiko-auth.ts           # Android auth module
    ├── radiko-parser.ts         # XML parsing, station-to-area mapping
    ├── radiko-stream.ts         # Stream XML playlist URL extraction
    ├── request-validation.ts    # Shared input validation helpers
    ├── stream-signing.ts        # Stateless signed proxy URL generation
    ├── storage.ts               # localStorage persistence
    └── auth-key-data.ts         # Android auth key (base64 constant)
```

## Disclaimer

This project is provided **strictly for educational and personal learning purposes only**. It is a non-commercial, open-source study project intended to explore web audio streaming, HLS protocol handling, and modern frontend development techniques.

**By using this software, you acknowledge and agree to the following:**

1. **Not affiliated with radiko**: This project is not affiliated with, endorsed by, or associated with radiko Co., Ltd. or any of its partner broadcasters in any way. "radiko" is a registered trademark of radiko Co., Ltd.

2. **Terms of Service**: Users are solely responsible for ensuring their use of this software complies with [radiko's Terms of Service](https://radiko.jp/#!/guidelines). The author(s) do not encourage, condone, or support any use of this software that violates radiko's Terms of Service or any applicable laws and regulations.

3. **Copyright**: All radio broadcast content, program metadata, station logos, and music information accessed through this software are copyrighted by their respective broadcasters and rights holders. This software does not store, redistribute, or re-host any copyrighted content.

4. **No warranty**: This software is provided "as-is" without any warranty of any kind, express or implied. The author(s) assume no liability for any damages, legal consequences, or other issues arising from the use or misuse of this software.

5. **Regional restrictions**: radiko's service is intended for use within Japan. This software's ability to access streams from different regions does not constitute authorization to circumvent geographic restrictions. Users should respect the intended service boundaries.

6. **Your responsibility**: You use this software entirely at your own risk. If you are unsure whether your use case is permitted, do not use this software and consult radiko's official terms directly.

**If you are a rights holder and have concerns about this project, please open an issue and it will be addressed promptly.**
