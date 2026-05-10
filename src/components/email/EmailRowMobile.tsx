import * as React from "react";
import { Star, Paperclip } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Tag } from "@/components/ui/Tag";
import type { Email } from "@/data/fixtures";

interface EmailRowMobileProps {
  email: Email;
  selected: boolean;
  focused: boolean;
  ghosted: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleStar: () => void;
  inSelectionSet: boolean;
}

export const EMAIL_ROW_MOBILE_HEIGHT = 76;

export const EmailRowMobile = React.memo(function EmailRowMobile({
  email,
  selected,
  focused,
  ghosted,
  onSelect,
  onToggleStar,
  inSelectionSet,
}: EmailRowMobileProps) {
  return (
    <div
      role="row"
      aria-selected={inSelectionSet}
      data-state={selected ? "selected" : focused ? "focused" : "default"}
      onClick={onSelect}
      className={cn(
        "group/row relative flex w-full items-stretch gap-2 px-3 py-2",
        "border-b border-border-subtle outline-none cursor-default",
        "transition-colors duration-fast ease-out",
        selected &&
          !ghosted &&
          "bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent",
        selected &&
          ghosted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-border-ghost",
        "active:bg-[rgba(255,255,255,0.04)]",
      )}
      style={{ minHeight: EMAIL_ROW_MOBILE_HEIGHT }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
        aria-label={email.starred ? "Unstar" : "Star"}
        className={cn(
          "flex w-5 shrink-0 items-start justify-center pt-0.5",
          "text-text-tertiary transition-opacity duration-fast",
          email.starred ? "opacity-full" : "opacity-dim",
          "rounded-xs focus-visible:opacity-full focus-visible:shadow-focus",
        )}
      >
        <Star
          size={14}
          fill={email.starred ? "var(--color-warning)" : "transparent"}
          color={email.starred ? "var(--color-warning)" : "currentColor"}
        />
      </button>

      <div className="shrink-0 pt-0.5">
        <Avatar
          name={email.from.name}
          size={28}
          colorSeed={email.from.colorSeed}
        />
      </div>

      <div className="min-w-0 flex-1">
        {/* Row 1: from + date */}
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-sans text-body",
              email.read
                ? "font-normal text-text-secondary"
                : "font-semibold text-text-primary",
            )}
          >
            {email.from.name}
          </span>
          {email.attachments.length > 0 && (
            <Paperclip size={11} className="shrink-0 text-text-tertiary" />
          )}
          <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
            {formatRelativeTime(email.receivedAt)}
          </span>
        </div>

        {/* Row 2: subject */}
        <div
          className={cn(
            "mt-0.5 truncate text-body",
            email.read
              ? "font-normal text-text-secondary"
              : "font-semibold text-text-primary",
          )}
        >
          {email.subject}
        </div>

        {/* Row 3: snippet + labels */}
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-small text-text-tertiary">
            {email.snippet}
          </span>
          {email.labels.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {email.labels.slice(0, 2).map((l) => (
                <Tag key={l.id} color={l.color} size="sm">
                  {l.name}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
