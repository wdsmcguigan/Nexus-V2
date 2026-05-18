# Nexus Relay — Deployment Guide

How to deploy the `nexus-relay` binary as a hosted sync server so multiple
devices can sync E2EE mail state without self-managing infrastructure.

---

## What the relay is

A single Rust binary (`relay-server/`). It stores only encrypted ciphertext
blobs — it never has access to vault keys or plaintext. Four HTTP endpoints,
one SQLite file, no external dependencies (SQLite is compiled in).

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_DB_PATH` | `./relay.db` | Path to the SQLite database file |
| `RELAY_PORT` | `3030` | TCP port to listen on |
| `RELAY_HOST` | `0.0.0.0` | Interface to bind |

---

## Step 1 — Build the binary

### Option A: Build locally for Linux (cross-compile from macOS)

```bash
rustup target add x86_64-unknown-linux-musl
brew install FiloSottile/musl-cross/musl-cross

cd relay-server/
cargo build --release --target x86_64-unknown-linux-musl
# Output: target/x86_64-unknown-linux-musl/release/nexus-relay
```

The `musl` target produces a fully static binary — no system libraries needed
on the server.

### Option B: Build on the server directly

```bash
# On a Debian/Ubuntu server:
curl https://sh.rustup.rs -sSf | sh
source $HOME/.cargo/env

cd relay-server/
cargo build --release
# Output: target/release/nexus-relay
```

---

## Step 2 — Choose a host

### Free / cheap options

| Option | Cost | Notes |
|--------|------|-------|
| **Fly.io** | Free tier (3 shared VMs) | Best for testing — free HTTPS, persistent volumes, no sleep |
| **Oracle Cloud Free Tier** | Always free | 2 ARM VMs, 1 GB RAM each — best long-term free option |
| **Railway** | $5/mo credit free | Free tier sleeps after inactivity — breaks 30-second sync |
| **Render** | Free tier | Also sleeps — not suitable for a sync daemon |
| **Hetzner CAX11** | €3.29/mo | Cheapest paid — ARM, 2 vCPU, 4 GB RAM |

**Fly.io is recommended for testing**: free persistent volume for `relay.db`,
automatic HTTPS/TLS with a `*.fly.dev` domain, no cold-start sleeping.

---

## Step 3 — Deploy to Fly.io

### 3a. Create a Dockerfile in `relay-server/`

```dockerfile
FROM rust:1.78-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/nexus-relay /usr/local/bin/nexus-relay
ENV RELAY_DB_PATH=/data/relay.db
ENV RELAY_PORT=3030
EXPOSE 3030
CMD ["nexus-relay"]
```

### 3b. Deploy

```bash
# Install flyctl
brew install flyctl
fly auth login

cd relay-server/
fly launch --name nexus-relay --region ord --no-deploy
# Creates fly.toml

# Create a persistent volume for relay.db (free tier: up to 3 GB)
fly volumes create relay_data --size 1

# Add volume mount to fly.toml:
# [mounts]
#   source = "relay_data"
#   destination = "/data"

fly deploy
```

Fly provides `https://nexus-relay.fly.dev` automatically with a valid TLS cert.

### 3c. Verify it's running

```bash
curl https://nexus-relay.fly.dev/api/v1/mutations?vault_id=test&after=0
# Should return: {"mutations":[]}
```

---

## Step 4 — Connect Nexus to the relay

In **Settings → Relay → Self-Hosted**, enter the relay URL:

```
https://nexus-relay.fly.dev
```

Hit Save. The 30-second sync loop starts immediately.

To pair a second device, go to **Settings → Relay → Show Enrollment Code** on
device 1, then enter that code on device 2 under **Settings → Relay → Pair
New Device**.

---

## Step 5 — Enable the "Nexus Relay" button (optional)

The "Nexus Relay (Coming Soon)" option in Settings is currently `disabled`. To
test the hosted-mode UX, find the relay mode picker in `SettingsPanel.tsx` and
remove the `disabled` attribute, setting the relay URL automatically to the
Fly endpoint when that option is selected.

---

## What you're skipping for testing (fine for 1–2 devices)

- **Auth** — the relay accepts pushes from any `vault_id`. Data is encrypted anyway and your `vault_id` is not guessable. For production, add HMAC-signed request headers.
- **Rate limiting** — no throttling on the server today.
- **Monitoring** — Fly's dashboard shows basic CPU/memory/request metrics.

---

## Production checklist (future)

- [ ] Add bearer token or HMAC auth per vault
- [ ] Rate limiting (per `vault_id`) to prevent abuse
- [ ] Migrate SQLite → PostgreSQL for multi-instance HA
- [ ] Add TLS mutual auth between Nexus client and relay
- [ ] Set up uptime monitoring (e.g. Fly health checks, Better Uptime)
- [ ] Prune old mutations (relay stores all history; add a TTL cleanup job)
- [ ] Write a Terms of Service / Privacy Policy for the hosted service
- [ ] Enable "Nexus Relay" option in Settings UI once infra is stable

---

## Relay API reference

All endpoints are unauthenticated in the current implementation.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/mutations` | Push an encrypted mutation |
| `GET` | `/api/v1/mutations?vault_id=…&after=…&exclude_device=…` | Pull mutations since cursor |
| `POST` | `/api/v1/enroll` | Create a 10-minute enrollment session |
| `GET` | `/api/v1/enroll/:code_hash` | Fetch (and consume) enrollment session |

Mutations are paginated at 200 per pull. The `seq` field is an autoincrement
integer used as the cursor.
