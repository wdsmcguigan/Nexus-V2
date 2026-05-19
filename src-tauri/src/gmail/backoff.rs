use std::time::Duration;

/// Exponential backoff with jitter and circuit-breaker for Gmail sync failures.
/// Pattern adapted from Pebble: base 15s, doubles each failure, caps at 300s,
/// ±25% jitter to prevent thundering herd, circuit-breaker after 5 consecutive failures.
pub struct SyncBackoff {
    consecutive_failures: u32,
    base_secs: u64,
    max_secs: u64,
    circuit_break_at: u32,
}

impl SyncBackoff {
    pub fn new() -> Self {
        Self {
            consecutive_failures: 0,
            base_secs: 15,
            max_secs: 300,
            circuit_break_at: 5,
        }
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    pub fn record_failure(&mut self) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
    }

    /// Returns true if the circuit breaker has tripped (too many consecutive failures).
    pub fn is_open(&self) -> bool {
        self.consecutive_failures >= self.circuit_break_at
    }

    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }

    /// Delay to wait before the next retry. Caller should check `is_open()` first.
    pub fn delay(&self) -> Duration {
        if self.consecutive_failures == 0 {
            return Duration::ZERO;
        }
        let exp = (self.consecutive_failures - 1).min(10);
        let base = self.base_secs as f64 * 2f64.powi(exp as i32);
        let capped = base.min(self.max_secs as f64);
        // ±25% jitter using a simple seed from the failure count and wall time
        let seed = self.consecutive_failures as u64
            ^ std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as u64)
                .unwrap_or(0);
        let jitter_frac = (seed.wrapping_mul(6364136223846793005).wrapping_add(1) >> 33) as f64
            / u32::MAX as f64; // 0.0..1.0
        let jitter = 0.75 + jitter_frac * 0.5; // 0.75..1.25
        Duration::from_secs_f64(capped * jitter)
    }
}

impl Default for SyncBackoff {
    fn default() -> Self {
        Self::new()
    }
}
