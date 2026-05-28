//! Standalone calendar engine (EP-14).
//!
//! Recurrence expansion runs here, in the Rust core, so every client (desktop
//! and — via a future FFI bridge — iOS) shares one RFC 5545 implementation
//! rather than reimplementing RRULE/DST/exception logic per platform.

pub mod recurrence;
