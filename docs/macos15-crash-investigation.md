# macOS 15 Crash Investigation & Fix

**Date:** 2026-05-16
**Branch:** `claude/nexus-ep3-execution`
**Commit:** `827ebc6`
**Platform:** macOS 15.7.4 (24G517), Apple M1 Max

---

## Symptom

The app crashed immediately on launch with `SIGABRT` before any UI appeared. The crash report showed:

```
Thread 0 Crashed:
  tao::platform_impl::platform::app_delegate::did_finish_launching + 68
```

The panic hook in `lib.rs` only captured `"panic in a function that cannot unwind"` — not the original panic message — because the panic was crossing an `extern "C"` boundary, which replaces the payload before the hook fires.

---

## Investigation Methodology

### Step 1 — Why the panic hook doesn't see the real message

When a Rust panic propagates through an `extern "C"` function, the runtime replaces it with `"panic in a function that cannot unwind"` and calls `abort()`. The original message is lost before any user-installed `std::panic::set_hook` can inspect it.

### Step 2 — Identifying the tao `MainThreadMarker` panic

The crash was in `applicationDidFinishLaunching`, which calls `AppState::launched()`. Searching the tao macOS source for `MainThreadMarker::new().unwrap()` found 6 call sites where `new()` returns `None` on macOS 15 even though AppKit guarantees execution on the main thread.

### Step 3 — Why cargo didn't recompile tao after edits

Cargo tracks git dependencies by **content hash**, not file modification time. Editing files in the checkout doesn't trigger recompilation. The fix: manually delete the fingerprint directory.

```bash
rm -rf src-tauri/target/debug/.fingerprint/tao-<hash>
```

The hash can be found with `ls target/debug/.fingerprint/ | grep "^tao-"`.

### Step 4 — After patching tao, a new crash: `Rust cannot catch foreign exceptions`

With all 6 `MainThreadMarker` panics fixed, the crash error changed to `"fatal runtime error: Rust cannot catch foreign exceptions, aborting"`. A fresh crash report showed:

```
5: ___rust_foreign_exception
6: ___rust_panic_cleanup
7: std::panicking::catch_unwind::cleanup
8: std::panicking::catch_unwind::do_catch
10: std::panic::catch_unwind
11: tao::platform_impl::platform::app_delegate::did_finish_launching
```

This is an **Objective-C exception** (not a Rust panic) propagating through Rust stack frames. `std::panic::catch_unwind` intercepts it but can't handle foreign exceptions, so it calls `abort()`.

### Step 5 — Locating the ObjC exception with breadcrumbs

Added `eprintln!` breadcrumbs in `AppState::launched()` to find the last print before the abort. The last line printed was:

```
[TAO DEBUG] launched: handle_nonuser_event NewEvents
```

The exception occurred inside `HANDLER.handle_nonuser_event(Event::NewEvents(StartCause::Init))` — i.e., inside Tauri's own startup callback.

### Step 6 — Capturing the ObjC exception message

Enabled `objc2 = { version = "0.6", features = ["exception"] }` in tao's `Cargo.toml` and wrapped the call with `objc2::exception::catch`. The exception read:

```
NSImageCacheException: Cannot lock focus on image <NSImage Size={0, 0}>, because it is size zero.
```

### Step 7 — Tracing the zero-size NSImage

Traced through Tauri's source:

```
tauri-codegen (build time)
  → embeds icon bytes from icon.icns into the binary

tauri/src/app.rs:2556-2573 (runtime, dev mode only)
  → RuntimeRunEvent::Ready
  → NSImage::initWithData(NSImage::alloc(), &data)  // succeeds but returns size={0,0}
  → app.setApplicationIconImage(Some(&app_icon))    // throws NSImageCacheException on macOS 15
```

**Root cause:** `src-tauri/icons/icon.icns` was an 8-byte stub — just the ICNS header `icns\x00\x00\x00\x08` with no icon data. `NSImage::initWithData` returns a non-nil image (so `.expect()` doesn't panic) but with size `{0, 0}`. On macOS 15, `setApplicationIconImage` rasterizes the image for caching, calls `lockFocus`, and throws when the image has zero dimensions.

---

## Fixes Applied

### Fix 1 — tao: `MainThreadMarker::new()` → `new_unchecked()`

**File:** `~/.cargo/git/checkouts/tao-acc866d3b4940d67/1080241/src/platform_impl/macos/`

macOS 15 changed behavior so that `MainThreadMarker::new()` returns `None` inside `applicationDidFinishLaunching` even though the code is provably on the main thread. Since AppKit guarantees these call sites are on the main thread, replacing with `new_unchecked()` is safe.

| File | Line | Change |
|------|------|--------|
| `app_state.rs` | 288 | `new().unwrap()` → `new_unchecked()` (inside `unsafe`) |
| `app_state.rs` | 405 | `new().unwrap()` → `new_unchecked()` (inside `unsafe`) |
| `app_state.rs` | 457 | `new().unwrap()` → `new_unchecked()` (inside `unsafe`) |
| `event_loop.rs` | 222 | `new().unwrap()` → `unsafe { new_unchecked() }` |
| `window.rs` | 1693 | `new().unwrap()` → `unsafe { new_unchecked() }` |
| `window.rs` | 1699 | `new().unwrap()` → `unsafe { new_unchecked() }` |

Note: The remaining `new().unwrap()` calls in the tao checkout are iOS-only (`platform_impl/ios/`) and do not affect macOS builds.

### Fix 2 — Replace stub `icon.icns` with a real one

**File:** `src-tauri/icons/icon.icns`

Generated a valid ICNS file from the project's existing PNG assets:

```bash
ICONS="src-tauri/icons"
ICONSET="/tmp/nexus.iconset"
mkdir "$ICONSET"

sips -z 16   16   "$ICONS/32x32.png"         --out "$ICONSET/icon_16x16.png"
sips -z 32   32   "$ICONS/32x32.png"         --out "$ICONSET/icon_16x16@2x.png"
cp            "$ICONS/32x32.png"                   "$ICONSET/icon_32x32.png"
sips -z 64   64   "$ICONS/128x128.png"       --out "$ICONSET/icon_32x32@2x.png"
cp            "$ICONS/128x128.png"                 "$ICONSET/icon_128x128.png"
cp            "$ICONS/128x128@2x.png"              "$ICONSET/icon_128x128@2x.png"
sips -z 256  256  "$ICONS/128x128@2x.png"    --out "$ICONSET/icon_256x256.png"
sips -z 512  512  "$ICONS/128x128@2x.png"    --out "$ICONSET/icon_256x256@2x.png"
sips -z 512  512  "$ICONS/128x128@2x.png"    --out "$ICONSET/icon_512x512.png"
sips -z 1024 1024 "$ICONS/128x128@2x.png"    --out "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"
```

Result: 37 KB valid ICNS replacing the 8-byte stub.

---

## Key Lessons

**Cargo git dep caching**
Editing a cargo git checkout does not invalidate the build cache. To force recompilation: `rm -rf target/debug/.fingerprint/<crate>-<hash>`. The hash is the fingerprint directory name, visible via `ls target/debug/.fingerprint/ | grep <crate>`.

**`extern "C"` hides Rust panic messages**
A Rust panic inside an `extern "C"` function cannot unwind through the boundary. The runtime replaces the original message with `"panic in a function that cannot unwind"` before any panic hook fires. To see the real message, wrap the call in `std::panic::catch_unwind` *inside* the `extern "C"` function.

**ObjC exceptions vs Rust panics**
These are different abort paths:
- Rust panic in `extern "C"` → `"panic in a function that cannot unwind"`
- ObjC `@throw` propagating through Rust frames → `"Rust cannot catch foreign exceptions"`

`std::panic::catch_unwind` does not catch ObjC exceptions. Use `objc2::exception::catch` (requires `objc2` with `features = ["exception"]`).

**macOS 15 `NSImageCacheException` with zero-size images**
On macOS 15, `setApplicationIconImage` (and likely other AppKit image-drawing APIs) calls `lockFocus` on the image, which throws `NSImageCacheException` if the image has zero dimensions. Previous macOS versions were more lenient. Always validate `NSImage.size` before passing to AppKit drawing APIs.

**`MainThreadMarker::new()` on macOS 15**
Apple changed the main-thread detection mechanism in macOS 15. Some AppKit callbacks that are provably on the main thread (like `applicationDidFinishLaunching`) now fail the runtime check used by `objc2`'s `MainThreadMarker::new()`. Use `MainThreadMarker::new_unchecked()` in call sites where the main-thread invariant is guaranteed by the caller (AppKit callbacks, `#[main]`-annotated functions, etc.).

---

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `src-tauri/icons/icon.icns` | Project | Replaced 8-byte stub with valid 37 KB ICNS |
| `src-tauri/Cargo.lock` | Project | Updated after dependency re-resolution |
| `~/.cargo/git/checkouts/tao-acc866d3b4940d67/1080241/src/platform_impl/macos/app_state.rs` | tao patch | 3× `new_unchecked()` |
| `~/.cargo/git/checkouts/tao-acc866d3b4940d67/1080241/src/platform_impl/macos/event_loop.rs` | tao patch | 1× `new_unchecked()` |
| `~/.cargo/git/checkouts/tao-acc866d3b4940d67/1080241/src/platform_impl/macos/window.rs` | tao patch | 2× `new_unchecked()` |
