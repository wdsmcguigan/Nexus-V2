import type { EditScope } from "@/state/mutations";

interface Props {
  value: EditScope;
  onChange: (scope: EditScope) => void;
}

/**
 * Recurrence-edit scope picker, shown only for events that are part of a
 * recurring series. "This and following" is intentionally disabled — it
 * requires splitting the series, which the mutation pipeline doesn't yet
 * support (`UnsupportedEditScopeError`, mutations.ts:1171). The disabled radio
 * keeps users aware the option exists without letting them corrupt the series.
 */
export function RecurrenceScopePicker({ value, onChange }: Props) {
  return (
    <fieldset className="rounded-sm border border-border-subtle p-3 space-y-1.5">
      <legend className="px-1 text-caption text-text-tertiary">Apply changes to</legend>
      <label className="flex items-center gap-2 text-small text-text-primary">
        <input
          type="radio"
          name="rrule-scope"
          checked={value === "occurrence"}
          onChange={() => onChange("occurrence")}
          className="accent-accent"
        />
        Only this event
      </label>
      <label className="flex items-center gap-2 text-small text-text-muted" title="Not yet supported — would require splitting the series">
        <input
          type="radio"
          name="rrule-scope"
          disabled
          checked={false}
          className="accent-accent"
        />
        This and following events (not yet supported)
      </label>
      <label className="flex items-center gap-2 text-small text-text-primary">
        <input
          type="radio"
          name="rrule-scope"
          checked={value === "series"}
          onChange={() => onChange("series")}
          className="accent-accent"
        />
        All events in the series
      </label>
    </fieldset>
  );
}
