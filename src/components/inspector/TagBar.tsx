/**
 * INS-TAG-BAR — Inline #hashtag editor with autocomplete from TGU.
 * Enter or comma commits; Backspace on empty removes the last chip.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { localStore } from "@/storage/local";
import { cn } from "@/lib/utils";

interface TagBarProps {
  messageId: string;
  tags: string[];
}

export function TagBar({ messageId, tags }: TagBarProps) {
  const addTag = useWorkspace((s) => s.addTag);
  const removeTag = useWorkspace((s) => s.removeTag);
  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const prefix = input.replace(/^#/, "").toLowerCase();
  const suggestions = prefix.length > 0
    ? localStore.getTagSuggestions(prefix, 8).map((t) => t.tag)
    : [];

  function commit(tag: string) {
    const clean = tag.replace(/^#/, "").trim();
    if (clean && !tags.includes(clean)) {
      addTag(messageId, clean);
      localStore.incrementTagUsage("local", clean);
    }
    setInput("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      const last = tags[tags.length - 1]!;
      removeTag(messageId, last);
    } else if (e.key === "Escape") {
      setInput("");
      setOpen(false);
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-1 rounded-xs border border-transparent",
        "px-1 py-0.5 transition-colors focus-within:border-border-subtle",
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 rounded-xs bg-surface-3 px-1.5 py-px font-mono text-mono-xs text-text-secondary"
        >
          #{tag}
          <button
            type="button"
            onClick={() => removeTag(messageId, tag)}
            className="ml-0.5 rounded-xs p-0.5 text-text-tertiary hover:text-text-secondary"
            aria-label={`Remove #${tag}`}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <Popover.Root open={open && suggestions.length > 0} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <input
            ref={inputRef}
            value={input}
            placeholder={tags.length === 0 ? "#add-tag" : ""}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              "min-w-[80px] flex-1 bg-transparent font-mono text-mono-xs text-text-primary outline-none",
              "placeholder:text-text-tertiary",
            )}
          />
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            sideOffset={4}
            align="start"
            className={cn(
              "z-50 min-w-[140px] overflow-hidden rounded-md border border-border-subtle",
              "bg-surface-2 p-1 shadow-lg",
            )}
          >
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(tag);
                }}
                className={cn(
                  "flex h-7 w-full items-center rounded-xs px-2 text-left",
                  "font-mono text-mono-xs text-text-secondary",
                  "hover:bg-surface-3 hover:text-text-primary",
                )}
              >
                #{tag}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
