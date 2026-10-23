# OpenRetro Party

Party uses infrastructure controlled by the OpenRetro operator. Users do not
configure a server, TURN, a password or an API key. The published desktop app
already knows the standard service address.

## What a player does

1. Open **Party → Criar sala**.
2. Copy the six-character code (for example `5JKL3A`) and send it to a friend.
3. The friend opens the standard `/party` page, enters the code and their name.
   A full `/party/5JKL3A` invitation also works and fills the code automatically.
4. The host approves the guest. The server assigns an exclusive J2–J4 slot.

The host occupies J1. The game runs on the host's Windows PC, and must support
local multiplayer for everyone to play together. Guests receive video and sound
and send control input through the operator's TURN server. They do not need the
game, emulator, desktop app or a VPN. Closing the dialog keeps Party running;
**Encerrar sala** revokes the invitation without stopping the game.

## What the operator hosts

A single Linux server can run all three components:

- **Node service:** room creation, random codes, membership and signaling.
- **coturn:** WebRTC video, audio and controller relay, with temporary credentials.
- **HTTPS proxy:** standard domain, guest page and secure WebSocket connection.

All production peer connections use `iceTransportPolicy: relay`. This forces
media and control traffic through the operator's TURN rather than an outside
provider. WebRTC payloads remain encrypted between the peers. No third-party
TURN or STUN service is contacted. The server does not execute or store games.

The code is ready for deployment; it does not create a public server or register
a domain. A real hostname and server access are needed to put it online.

## Deployment

If no server exists yet, first provision a Linux VPS with a public IPv4 and
register a domain. No account, subscription or domain is created by this code.
With those values available, generate the complete deployment package:

```sh
node party-server/deploy/prepare.mjs party.yourdomain.com turn.yourdomain.com YOUR_VPS_IPV4
```

It creates `deploy/generated/` with a Docker Compose stack, HTTPS configuration,
TURN configuration, an automatically generated secret and Portuguese deployment
instructions. It refuses to overwrite an existing package. Generated secrets
are excluded from Git. After DNS and the firewall are ready, run
`docker compose up -d --build` from that directory **on the Linux VPS**.
The stack waits for HTTPS certificates before starting TLS TURN. Certificate
renewal is handled by Caddy; restart the `turn` service after a certificate
rotation so coturn reloads it. This stack has not been run against a real VPS.

For a manual deployment, follow these steps:

1. Point the web and TURN hostnames at your server. Example hostnames in these
   files are placeholders, not services that already exist.
2. Install Node 22.16+ (or Node 24), coturn and an HTTPS proxy such as Caddy.
3. Copy `party-server/.env.example` to `party-server/.env`. Set `PUBLIC_URL` to
   the final web origin and `TURN_URLS` to your coturn addresses.
4. Generate one long random secret. Set it as `TURN_SECRET` in the service and
   `static-auth-secret` in coturn. It never goes into the app or invite.
5. Use `party-server/deploy/turnserver.conf.example` as the coturn configuration.
   Replace hostnames and certificate paths. Configure `external-ip` if the server
   is behind NAT. Obtain a valid certificate for the TURN hostname.
6. Allow TCP 80/443 for HTTPS, UDP/TCP 3478 and TCP 5349 for TURN, and UDP
   49160–49260 for relayed media. Configure both the OS and hosting firewall.
7. Run `npm ci` and `npm run start:standalone` inside `party-server/`, supervised by systemd or
   your host's process manager. Node listens on loopback by default. The Docker
   image instead listens inside its container; publish it on loopback only.
8. Adapt `deploy/Caddyfile.example` for HTTPS and WebSocket upgrades. The proxy
   must overwrite `X-Party-Client-IP`; enable `TRUST_PROXY=true` only with this
   proxy in front of the backend. Do not expose backend port 8787 publicly.
9. Set `OPENRETRO_PARTY_URL` to that public web origin **when compiling the
   desktop release**. Rust embeds this non-secret default. No configuration is
   needed on users' PCs. The same environment variable can override it locally
   for development. There is no client host key.

Coturn's [REST authentication](https://github.com/coturn/coturn/wiki/turnserver)
uses an expiring username and HMAC credential. The backend issues four-hour
credentials; rooms close after three hours. The sample coturn config includes
allocation and bandwidth limits. Adjust these to the server's capacity.

This first implementation has no accounts. The host's WebSocket owns the room;
knowing a room code does not authorize someone to control the game or manage
participants. Global room capacity, per-IP room and creation limits, connection
limits, message limits and guest approval bound the public flow. These do not
replace account-based quotas if the service later grows into a paid product.

## Local development

In one PowerShell terminal, from the repository root:

```powershell
$env:PUBLIC_URL = 'http://localhost:8787'
$env:ALLOW_STUN_ONLY = 'true'
node party-server/server.mjs
```

In another terminal:

```powershell
$env:OPENRETRO_PARTY_URL = 'http://localhost:8787'
npm run tauri dev
```

Development mode uses direct host candidates with no external STUN service.
It is useful on one machine; it cannot establish every internet connection.
HTTP is accepted only on loopback. Production requires HTTPS and your own TURN.

## Transport and current limits

The token-authenticated loopback `/party-stream` bridge reuses native capture
and input. It filters media when no compatible runtime session is open. The
host converts local lossless frames (PNG for small frames, raw RGBA for large
frames) and game PCM audio into WebRTC tracks. Raw frames avoid a redundant
PNG encode/decode on the host. The canvas preserves the source aspect ratio,
with at most 30 fps and
5 Mbps per guest. WebRTC may reduce resolution to preserve frame rate under
CPU or network pressure. This does not add detail to low-resolution games.

Audio comes directly from the managed game's runtime through a process-specific
shared-memory ring. Calls, browser playback and notifications are excluded;
there is no system-output capture fallback. No camera or microphone access
is requested. Guest controller states contain sequence numbers, buttons and
axes; the host validates them and applies the assigned port. The native relay
releases stale input, and closing its socket releases held controls.

Rooms are memory-only and disappear on server restart. Reconnection currently
requires a new admission request. Seamless reconnection, spectators, voice,
accounts and server-side game execution are not implemented.

## Validation

```powershell
npm test
npm run build
npm test --prefix party-server
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Service tests use real local WebSockets to cover creation without client keys,
approval, exclusive slots, capacity, removal, invalid invites, host ownership,
shutdown and creation limits. TURN configuration tests cover the configured
URLs, credential lifetime, absence of the permanent secret and relay policy.

Before release, test coturn connectivity on the deployed server and a real game
between independent networks, including physical controls, mobile Safari/Chrome,
audio/video synchronization, disconnect release, bandwidth use and operation
while the emulator owns the main window. Unit tests do not verify that path.

