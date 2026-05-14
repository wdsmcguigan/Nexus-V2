/**
 * LST-EMAIL-ROW — renders Message directly with all metadata axes.
 * STR icon at chosen color, PRI indicator, LBL chips, TAG chips, STA chip,
 * PIN/MUT indicators.
 */
import * as React from "react";
import {
  Star,
  Paperclip,
  Pin,
  BellOff,
  CheckCircle2,
  AlertOctagon,
  HelpCircle,
  ChevronRight,
  Info,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Tag } from "@/components/ui/Tag";
import { pickPanelLink } from "@/design-system/tokens";
import type { Message, StarStyle, Label, Status } from "@/data/types";
import type { Density } from "@/design-system/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailRowProps {
  message: Message;
  density: Density;
  selected: boolean;
  focused: boolean;
  ghosted: boolean;
  inSelectionSet: boolean;
  /** Pre-resolved labels for this message (looked up by parent). */
  labels: Label[];
  /** Pre-resolved status (null if not set). */
  status: Status | null;
  onSelect: (e: React.MouseEvent) => void;
  onFocus: () => void;
  onToggleStar: () => void;
  onToggleCheck: (checked: boolean) => void;
}

// ─── Star icon mapping ────────────────────────────────────────────────────────

interface StarEntry {
  icon: LucideIcon;
  color: string;
}

const STAR_MAP: Record<StarStyle, StarEntry> = {
  yellow: { icon: Star, color: "var(--color-link-2)" },
  red: { icon: Star, color: "var(--color-link-1)" },
  orange: { icon: Star, color: "oklch(0.66 0.16 55)" },
  green: { icon: Star, color: "var(--color-link-3)" },
  blue: { icon: Star, color: "var(--color-link-5)" },
  purple: { icon: Star, color: "var(--color-link-6)" },
  "check-green": { icon: CheckCircle2, color: "var(--color-link-3)" },
  "bang-red": { icon: AlertOctagon, color: "var(--color-link-1)" },
  "question-purple": { icon: HelpCircle, color: "var(--color-link-6)" },
  "guillemet-orange": { icon: ChevronRight, color: "oklch(0.66 0.16 55)" },
  "info-blue": { icon: Info, color: "var(--color-link-5)" },
  "bang-yellow": { icon: AlertTriangle, color: "var(--color-link-2)" },
};

// ─── Priority indicator ───────────────────────────────────────────────────────

const PRI_COLORS: Record<number, string> = {
  1: "var(--color-link-1)", // urgent red
  2: "oklch(0.66 0.16 55)", // high orange
  3: "var(--color-link-5)", // normal blue
  4: "var(--color-text-tertiary)", // low grey
};

const HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

// ─── Component ────────────────────────────────────────────────────────────────

export const EmailRow = React.memo(function EmailRow({
  message: msg,
  density,
  selected,
  focused,
  ghosted,
  inSelectionSet,
  labels,
  status,
  onSelect,
  onFocus,
  onToggleStar,
  onToggleCheck,
}: EmailRowProps) {
  const showAvatar = density !== "compact";
  const showSnippet = density !== "compact";
  const showStatusTags = density === "comfortable" || density === "cozy";
  const cozy = density === "cozy";
  const compact = density === "compact";
  const maxLabels = compact ? 2 : cozy ? 4 : 3;
  const height = HEIGHT_BY_DENSITY[density];

  const fromColorSeed = pickPanelLink(msg.fromAddr.email);
  const isRead = msg.flags.read;
  const isStarred = !!msg.star;

  // Priority: only show P1/P2 as badges (P3/P4/null are suppressed)
  const showPriBadge = msg.priority !== null && msg.priority <= 2;

  return (
    <div
      role="row"
      aria-selected={inSelectionSet}
      data-density={density}
      data-state={selected ? "selected" : focused ? "focused" : "default"}
      onClick={onSelect}
      onMouseEnter={onFocus}
      tabIndex={focused ? 0 : -1}
      className={cn(
        "group/row relative flex w-full items-stretch px-2",
        "border-b border-border-subtle cursor-default outline-none",
        "transition-colors duration-fast ease-out",
        "hover:bg-[rgba(255,255,255,0.03)]",
        focused &&
          !selected &&
          "bg-[rgba(255,255,255,0.045)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:opacity-60",
        selected &&
          !ghosted &&
          "bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent",
        selected &&
          ghosted &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-border-ghost",
        msg.muted && "opacity-60",
        "focus-visible:shadow-focus",
      )}
      style={{ minHeight: height }}
    >
      {/* Priority left-stripe (behind selection indicator) */}
      {msg.priority !== null && !selected && !focused && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: PRI_COLORS[msg.priority] ?? "transparent", opacity: 0.5 }}
        />
      )}

      {/* Checkbox */}
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
          aria-label={`Select from ${msg.fromAddr.name}`}
          className="size-3.5 cursor-pointer accent-accent"
        />
      </div>

      {/* Star */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
        aria-label={isStarred ? "Unstar" : "Star"}
        className={cn(
          "flex w-5 shrink-0 items-center justify-center self-start pt-1.5",
          "transition-opacity duration-fast",
          isStarred ? "opacity-full" : "opacity-dim hover:opacity-full",
          "focus-visible:opacity-full focus-visible:shadow-focus rounded-xs",
        )}
      >
        {msg.star && STAR_MAP[msg.star] ? (() => {
          const { icon: Icon, color } = STAR_MAP[msg.star!]!;
          return <Icon size={12} fill={color} style={{ color }} />;
        })() : (
          <Star size={12} className="text-text-tertiary" />
        )}
      </button>

      {/* Avatar */}
      {showAvatar && (
        <div className="flex shrink-0 items-start self-start pt-1 pr-2">
          <Avatar name={msg.fromAddr.name} size={cozy ? 28 : 20} colorSeed={fromColorSeed} />
        </div>
      )}

      {/* From + Subject + Snippet + meta chips */}
      <div className="min-w-0 flex-1 self-stretch py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {/* Priority badge (P1/P2 only) */}
          {showPriBadge && (
            <span
              className="shrink-0 font-mono text-mono-xs font-bold leading-none"
              style={{ color: PRI_COLORS[msg.priority!] }}
            >
              {"!".repeat(msg.priority === 1 ? 3 : 2)}
            </span>
          )}
          <span
            className={cn(
              "shrink-0 truncate font-sans text-body",
              cozy ? "max-w-[160px]" : "max-w-[120px]",
              isRead ? "font-normal text-text-secondary" : "font-semibold text-text-primary",
            )}
          >
            {msg.fromAddr.name}
          </span>
          {/* PIN indicator */}
          {msg.pinned && (
            <Pin size={10} className="shrink-0 text-text-tertiary" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-body",
              isRead ? "font-normal text-text-secondary" : "font-semibold text-text-primary",
            )}
          >
            {msg.subject}
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
            {msg.snippet}
          </div>
        )}

        {/* Status + tags (comfortable / cozy only) */}
        {showStatusTags && (status || msg.tags.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {status && (
              <span
                className="inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 font-mono text-mono-xs uppercase"
                style={{
                  color: `var(--color-link-${status.color})`,
                  backgroundColor: `color-mix(in oklch, var(--color-link-${status.color}) 18%, transparent)`,
                }}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--color-link-${status.color})` }}
                />
                {status.name}
              </span>
            )}
            {msg.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex h-[18px] items-center rounded-xs bg-surface-3 px-1.5 font-mono text-mono-xs text-text-tertiary"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Labels — right-aligned, visible at all densities */}
      {labels.length > 0 && (
        <div
          className={cn(
            "flex shrink-0 items-start gap-1 pr-1",
            compact ? "self-center" : "mt-0.5 flex-wrap justify-end self-start pt-1.5",
            compact ? "max-w-[96px]" : "max-w-[140px]",
          )}
        >
          {labels.slice(0, maxLabels).map((l) => (
            <Tag key={l.id} color={l.color as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8} size="sm">
              {l.name}
            </Tag>
          ))}
        </div>
      )}

      {/* Attachment + mute indicator */}
      <div className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-1.5">
        {msg.attachmentRefs.length > 0 && (
          <Paperclip size={12} className="text-text-tertiary" />
        )}
        {msg.muted && (
          <BellOff size={10} className="text-text-tertiary opacity-dim" />
        )}
      </div>

      {/* Date */}
      <div
        className={cn(
          "flex w-16 shrink-0 items-start justify-end self-start pt-1.5 font-mono",
          density === "compact" ? "text-mono-xs" : "text-mono-sm",
          "text-text-tertiary",
          "transition-opacity duration-fast group-hover/row:opacity-dim",
        )}
      >
        {formatRelativeTime(new Date(msg.receivedAt))}
      </div>
    </div>
  );
});
