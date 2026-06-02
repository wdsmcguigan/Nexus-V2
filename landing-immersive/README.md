# NEXUS — Immersive Landing (`landing-immersive/`)

An experimental, cinematic landing page for NEXUS — the inbox reimagined as a
living digital universe. A counterpart to the production marketing page in
`landing v0.5/`, built to showcase the brand with a next-gen, immersive feel.

## What it is

A **single self-contained experience** with **zero build step and zero runtime
dependencies** (only Google Fonts over CDN). Open `index.html` in any modern
browser.

```
landing-immersive/
├── index.html   # markup + all CSS (design tokens, glassmorphism, layout)
├── app.js       # the engine (canvas 3D field, nebula, interactions)
└── favicon.svg
```

## The experience

- **Custom WebGL-style 3D particle constellation** — a Fibonacci-sphere "nexus
  core" plus an ambient star cloud, projected through a hand-rolled perspective
  camera in `<canvas>`. Nearby shell points link into a depth-faded neon
  constellation. The camera eases toward the pointer (or device orientation on
  mobile) and **descends into the field as you scroll** — a camera-like
  transition. No Three.js required; written from scratch for full control and
  offline robustness.
- **Drifting nebula** — a second additive-blended canvas layer of slow neon
  aurora blobs for atmospheric depth.
- **Floating holographic interface** — a glassmorphism mock of the NEXUS vault
  (inbox, tags, live sync badges, floating stat cards) that **tilts in 3D**
  toward the cursor.
- **Layered glass cards** with pointer-tracked radial glow and depth hover.
- **Orbital architecture diagram** — the encrypted vault core with providers,
  the mutation pipeline, the Lamport clock, and the E2EE relay in orbit.
- **Cinematic motion** — boot sequence, masked hero title reveal, reveal-on-
  scroll, custom cursor with magnetic ring, scroll-progress rail, marquee.

## Accessibility & performance

- Fully respects `prefers-reduced-motion` (animations collapse, content shows).
- Adapts particle count and DPR to viewport/device for smooth framerates.
- Touch devices fall back to the native cursor and device-orientation parallax.

## Content

Copy is drawn from the real product: local-first SQLCipher vault,
XChaCha20-Poly1305 + BLAKE3 sync over a zero-knowledge relay, kanban workflows,
FTS5 search, a rules engine, and multi-provider support (Gmail, IMAP IDLE,
Outlook OAuth, JMAP). See the root `CLAUDE.md` for the architecture.
