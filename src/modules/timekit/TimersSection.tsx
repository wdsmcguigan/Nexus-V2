import { useEffect, useState } from "react";
import { localStore } from "@/storage/local";
import { useCountdownTimers } from "@/modules/timekit/hooks";
import {
  createTimerMutation, startTimerMutation, pauseTimerMutation,
  resumeTimerMutation, resetTimerMutation, deleteTimerMutation,
} from "@/modules/timekit/mutations";
import { timerRemainingMs, formatDuration } from "@/modules/timekit/time";
import type { CountdownTimer } from "@/data/types";

/** Create and control countdown timers; remaining time ticks live in the UI. */
export function TimersSection() {
  const timers = useCountdownTimers();
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState("");
  const [seconds, setSeconds] = useState("60");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function create() {
    const secs = Number(seconds);
    if (!Number.isFinite(secs) || secs <= 0) return;
    createTimerMutation(label.trim() || "Timer", Math.round(secs * 1000), localStore);
    setLabel("");
    setSeconds("60");
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body text-text-primary"
          placeholder="Label"
          aria-label="Timer label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="w-20 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-body tabular-nums text-text-primary"
          placeholder="sec"
          aria-label="Timer seconds"
          inputMode="numeric"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
        />
        <button type="button" onClick={create} className="rounded-md bg-surface-2 px-3 py-1 text-small text-text-primary">
          Add timer
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {timers.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-body text-text-primary">{t.label}</div>
              <div className="text-small tabular-nums text-text-secondary">
                {t.state === "done" ? "Done" : formatDuration(timerRemainingMs(t, now))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">{controls(t)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function controls(t: CountdownTimer) {
  const btn = "rounded-sm bg-surface-1 px-2 py-1 text-small text-text-primary";
  if (t.state === "idle") {
    return <button type="button" className={btn} onClick={() => startTimerMutation(t.id, localStore)}>Start</button>;
  }
  if (t.state === "running") {
    return <button type="button" className={btn} onClick={() => pauseTimerMutation(t.id, localStore)}>Pause</button>;
  }
  if (t.state === "paused") {
    return (
      <>
        <button type="button" className={btn} onClick={() => resumeTimerMutation(t.id, localStore)}>Resume</button>
        <button type="button" className={btn} onClick={() => resetTimerMutation(t.id, localStore)}>Reset</button>
      </>
    );
  }
  // done
  return (
    <>
      <button type="button" className={btn} onClick={() => resetTimerMutation(t.id, localStore)}>Reset</button>
      <button type="button" className={btn} onClick={() => deleteTimerMutation(t.id, localStore)}>Delete</button>
    </>
  );
}
