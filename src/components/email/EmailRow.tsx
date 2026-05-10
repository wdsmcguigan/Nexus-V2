import * as React from "react";
import { Star, Paperclip } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Tag } from "@/components/ui/Tag";
import type { Email } from "@/data/fixtures";
import type { Density } from "@/design-system/tokens";

interface EmailRowProps {
  email: Email;
  density: Density;
  selected: boolean;
  focused: boolean;
  ghosted: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onFocus: () => void;
  onToggleStar: () => void;
  onToggleCheck: (checked: boolean) => void;
  inSelectionSet: boolean;
}

const HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

/**
 * Email list row — see spec §5.1, §3.1.
 * Visual states layered as data attributes so a single CSS layer per state.
 */
export const EmailRow = React.memo(function EmailRow({
  email,
  density,
  selected,
  focused,
  ghosted,
  onSelect,
  onFocus,
  onToggleStar,
  onToggleCheck,
  inSelectionSet,
}: EmailRowProps) {
  const showAvatar = density !== "compact";
  const showSnippet = density !== "compact";
  const showLabels = density === "comfortable" || density === "cozy";
  const cozy = density === "cozy";
  const height = HEIGHT_BY_DENSITY[density];

  return (
    <div
      role="row"
      aria-selected={inSelectionSet}
      data-density={density}
      data-state={
        selected ? "selected" : focused ? "focused" : "default"
      }
      onClick={onSelect}
      onMouseEnter={onFocus}
      tabIndex={focused ? 0 : -1}
      className={cn(
        "group/row relative flex w-full items-stretch px-2",
        "border-b border-border-subtle cursor-default outline-none",
        "transition-colors duration-fast ease-out",
        // Hover
        "hover:bg-[rgba(255,255,255,0.03)]",
        // Focused (kbd cursor)
        focused &&
          !selected &&
          "bg-[rgba(255,255,255,0.045)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:opacity-60",
        // Selected (panel focused)
        selected &&
          !ghosted &&
          "bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent",
        // Ghosted selection (panel unfocused)
        selected &&
          ghosted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-border-ghost",
        "focus-visible:shadow-focus",
      )}
      style={{ minHeight: height }}
    >
      {/* Checkbox (always at cozy, hover/select otherwise) */}
      <div
        className={cn(
          "flex w-6 items-center justify-center self-start pt-1.5",
          cozy ? "opacity-full" : "opacity-0 group-hover/row:opacity-full",
          inSelectionSet && "opacity-full",
        )}
      >
        <input
          type="checkbox"
          checked={inSelectionSet}
          onChange={(e) => {
            e.stopPropagation();
            onToggleCheck(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select email from ${email.from.name}`}
          className="size-3.5 cursor-pointer accent-accent"
        />
      </div>

      {/* Star */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
        aria-label={email.starred ? "Unstar" : "Star"}
        className={cn(
          "flex w-5 shrink-0 items-center justify-center self-start pt-1.5",
          "text-text-tertiary transition-opacity duration-fast",
          email.starred ? "opacity-full" : "opacity-dim hover:opacity-full",
          "focus-visible:opacity-full focus-visible:shadow-focus rounded-xs",
        )}
      >
        <Star
          size={12}
          fill={email.starred ? "var(--color-warning)" : "transparent"}
          color={email.starred ? "var(--color-warning)" : "currentColor"}
        />
      </button>

      {/* Avatar */}
      {showAvatar && (
        <div className="flex shrink-0 items-start self-start pt-1 pr-2">
          <Avatar
            name={email.from.name}
            size={cozy ? 28 : 20}
            colorSeed={email.from.colorSeed}
          />
        </div>
      )}

      {/* From + Subject + Snippet */}
      <div className="min-w-0 flex-1 self-stretch py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "shrink-0 truncate font-sans text-body",
              cozy ? "max-w-[160px]" : "max-w-[120px]",
              email.read
                ? "font-normal text-text-secondary"
                : "font-semibold text-text-primary",
            )}
          >
            {email.from.name}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              email.read
                ? "font-normal text-text-secondary"
                : "font-semibold text-text-primary",
            )}
          >
            {email.subject}
          </span>
        </div>
        {showSnippet && (
          <div
            className={cn(
              "mt-0.5 min-w-0 text-small text-text-tertiary transition-opacity duration-fast",
              "opacity-dim group-hover/row:opacity-full",
              selected && !ghosted && "opacity-full",
              cozy ? "line-clamp-2" : "truncate",
            )}
          >
            {email.snippet}
          </div>
        )}
      </div>

      {/* Attachment */}
      {email.attachments.length > 0 && (
        <div className="flex w-5 shrink-0 items-center justify-center self-start pt-1.5">
          <Paperclip size={12} className="text-text-tertiary" />
        </div>
      )}

      {/* Labels */}
      {showLabels && email.labels.length > 0 && (
        <div className="hidden @[640px]:flex shrink-0 items-center gap-1 self-start pt-1.5 pr-2">
          {email.labels.slice(0, cozy ? 5 : 3).map((l) => (
            <Tag key={l.id} color={l.color} size="sm">
              {l.name}
            </Tag>
          ))}
        </div>
      )}

      {/* Date */}
      <div
        className={cn(
          "flex w-16 shrink-0 items-start justify-end self-start pt-1.5 font-mono",
          density === "compact" ? "text-mono-xs" : "text-mono-sm",
          "text-text-tertiary",
          "transition-opacity duration-fast group-hover/row:opacity-dim",
        )}
      >
        {formatRelativeTime(email.receivedAt)}
      </div>
    </div>
  );
});
