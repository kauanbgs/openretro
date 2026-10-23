# OpenRetro Party on Cloudflare

The default deployment uses Cloudflare Workers, SQLite Durable Objects and
Cloudflare Realtime TURN. A VPS, Docker, a separately registered domain and a
coturn installation are not required.

Current service: https://openretro-party.openretro-party-server.workers.dev/party

The public page and Worker are deployed. The Worker refuses room creation if
the two TURN secrets are missing, so the app cannot create invitations without
a configured internet relay.

## Player experience

1. Open **Party → Criar sala** in the desktop app.
2. Copy the six-character room code and send it to a friend.
3. The friend opens the standard Party page, enters the code and their name.
   A `/party/5JKL3A` link fills the code automatically.
4. The host approves the participant. Guests occupy exclusive J2–J4 slots;
   J1 stays on the PC. Controls work by touch, keyboard or supported gamepad.

The game runs on the host's Windows PC. Guests do not need the game, emulator,
OpenRetro installer, a VPN, account or server settings. Closing the dialog keeps
Party running. Ending the room disconnects guests and invalidates the code.

## One-time Cloudflare setup

Node 22+ is needed; the existing Node 24 runtime is supported.
From the repository root:

```powershell
npm ci --prefix party-server
npm run cf:login --prefix party-server
npm run deploy --prefix party-server
```

The configuration is `party-server/cloudflare/wrangler.jsonc`. It deploys the
public guest page as Worker assets, a global room directory and one hibernating
Durable Object per room. SQLite migrations are included. A `workers.dev`
address works immediately; a custom domain is optional.

Wrangler login grants the Worker deployment permissions, but it does not grant
**Calls Write**, which is required to create a TURN key. In the Cloudflare
Dashboard, open **Realtime → TURN**, create a key named **OpenRetro Party** and
copy the Key ID and the key's token. Do not paste these into chat or commit them.

Run the operator helper:

```powershell
npm run turn:configure --prefix party-server
```

It prompts for the Key ID and masks the token. It validates the key with the
TURN credential API, then sends `TURN_KEY_ID` and `TURN_API_TOKEN` directly to
Workers Secrets. No permanent key is written into the project or command
history. The helper is for the operator only; players never run it.

After configuration, validate room creation and a real game between two
independent networks. No paid subscription is automatically enabled by this
repository. Usage remains subject to the account's Cloudflare plan and TURN
bandwidth pricing.

References:
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [TURN credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [TURN pricing](https://www.cloudflare.com/products/turn-sfu/)

## Desktop endpoint

`src-tauri/src/remote_play/party-url.txt` contains the shipped public service
origin. It is not a credential. The app uses it automatically, without a
configuration screen. `OPENRETRO_PARTY_URL` can override it at build time or
runtime for development or a separately operated deployment.

If a custom domain is added later, bind it to the Worker and update this file
before building the desktop release. Keep the `/party/<CODE>` path.

## Protocol and authorization

- `POST /api/rooms` reserves a unique code and returns a random 256-bit host
  ticket. Tickets are kept in memory, never in invite links or localStorage.
- `/signal?room=<CODE>` upgrades to a WebSocket. The host claims its room with
  the ticket in its first message. Knowing the code cannot claim host ownership.
- The server stores only a SHA-256 hash of the ticket. Browser guests request
  admission; only the host's authenticated socket can approve, assign or remove.
- SDP/ICE signaling only passes between the host and an approved guest. Guests
  cannot target another guest, self-approve, claim J1 or override their slot.
- The permanent TURN token stays in Workers Secrets. Clients receive four-hour
  temporary ICE credentials. The server filters STUN-only and browser-blocked
  port 53 URLs; production peers use `iceTransportPolicy: relay`.
- Native capture and controller input remain on the PC. WebRTC media and pad
  states travel through TURN; video is never sent through Durable Objects.
- WebSocket membership is serialized in socket attachments, and room metadata
  is persisted. Hibernation does not reset host ownership, approval or slots.
  Ping/pong can be answered without waking the object every time.
- Reservations expire after two minutes if unclaimed. Idle unauthenticated
  sockets expire after 30 seconds, pending guest requests after two minutes and
  active rooms after three hours. Host disconnection closes the room.
- Directory quotas persist across hibernation: default 32 rooms globally, two
  per IP, 12 creation requests per IP per ten minutes and 60 join attempts per
  minute. Room sockets and signaling messages also have limits. This pilot
  does not include account-based quotas or paid subscriptions.

The low-level HTTP endpoint validates native/browser origins for CORS. The
service does not rely on CORS for authentication; host capabilities and server
membership checks enforce authorization. Raw IP addresses are hashed before
entering the directory. Debug logging is disabled in the deployment config.

## Local development

Copy `party-server/cloudflare/.dev.vars.example` to `.dev.vars` in the same
folder (ignored by Git), then run:

```powershell
npm start --prefix party-server
```

Local mode uses host candidates without a paid TURN API. The public Worker
rejects room creation if `ALLOW_LOCAL_TEST=true` is accidentally deployed.
For native development set `OPENRETRO_PARTY_URL=http://localhost:8787` before
`npm run tauri dev`. Do not publish that development setting.

The previous standalone Node/coturn implementation remains available with
`npm run start:standalone --prefix party-server`. Its setup is documented in
[PARTY_SELF_HOSTED.md](PARTY_SELF_HOSTED.md). It is an alternative deployment,
not part of the Cloudflare service.

## Verification

```powershell
npm test --prefix party-server
npm run deploy:check --prefix party-server
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Cloudflare tests run on the actual local workerd runtime through Miniflare,
with SQLite Durable Objects and real WebSocket upgrades. They verify host
capabilities, exclusive slots, approval, signaling identities, removal, host
shutdown, code invalidation, quotas, CORS, public asset routes and failure when
TURN configuration is missing. The TURN API is mocked in credential unit tests;
that does not establish live TURN reachability or game performance.

Before release, test a real game, physical controls and mobile browsers between
independent networks. Measure latency, audio/video synchronization, bandwidth,
input release on disconnect and the host WebView while the emulator is active.
Voice, spectators, seamless reconnection and cloud game execution are not part
of this version.
