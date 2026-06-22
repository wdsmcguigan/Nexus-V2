import type { Alarm, CountdownTimer } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { toast } from "sonner";
import { timerEndsAt } from "@/modules/timekit/time";
import { completeTimerMutation, fireAlarmMutation } from "@/modules/timekit/mutations";

/** Enabled, not-yet-fired alarms whose fire time has passed. Pure. */
export function dueAlarms(now: number, alarms: Iterable<Alarm>): Alarm[] {
  const out: Alarm[] = [];
  for (const a of alarms) {
    if (a.enabled && a.firedAt == null && a.fireAt <= now) out.push(a);
  }
  return out;
}

/** Running timers whose end time has passed. Pure; never returns non-running timers. */
export function dueTimers(now: number, timers: Iterable<CountdownTimer>): CountdownTimer[] {
  const out: CountdownTimer[] = [];
  for (const t of timers) {
    if (t.state !== "running" || t.startedAt == null) continue;
    const ends = timerEndsAt(t);
    if (ends != null && ends <= now) out.push(t);
  }
  return out;
}

/** Short Web-Audio beep; silently no-ops where AudioContext is unavailable. */
function chime(): void {
  try {
    const w = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio available */
  }
}

/**
 * Start the 1s tick worker. Main-window-only (gated by main.tsx). Each tick fires
 * due timers: emits COMPLETE_TIMER (source:"module"), toasts, and chimes. The state
 * flip makes firing idempotent (a done timer is no longer "due"). Returns a disposer.
 */
export function startTimekitTicker(store: LocalStore): () => void {
  const id = setInterval(() => {
    const now = Date.now();
    for (const t of dueTimers(now, store.countdownTimers.values())) {
      completeTimerMutation(t.id, store, { source: "module" });
      toast(`Timer done: ${t.label}`);
      chime();
    }
    for (const a of dueAlarms(now, store.alarms.values())) {
      fireAlarmMutation(a.id, store, { source: "module" });
      toast(`Alarm: ${a.label}`);
      chime();
    }
  }, 1000);
  return () => clearInterval(id);
}
