import { Inbox, Search, PenSquare, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import type { MobileTab } from "@/state/workspace";
import { cn } from "@/lib/utils";

interface TabDef {
  id: MobileTab;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: "mail", label: "Mail", icon: Inbox },
  { id: "search", label: "Search", icon: Search },
  { id: "compose", label: "Compose", icon: PenSquare },
  { id: "settings", label: "Settings", icon: Settings },
];

export function MobileTabBar() {
  const tab = useWorkspace((s) => s.mobileTab);
  const setMobileTab = useWorkspace((s) => s.setMobileTab);
  const setMobileView = useWorkspace((s) => s.setMobileView);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);

  function handleTab(id: MobileTab) {
    setMobileTab(id);
    if (id === "mail") setMobileView("nav");
    else if (id === "search") setPaletteOpen(true);
    else if (id === "compose") setComposerOpen(true);
  }

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className={cn(
        "flex shrink-0 items-stretch border-t border-border-default bg-surface-1",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {TABS.map((t) => {
        const active = tab === t.id;
        const Icon = t.icon;
        const isFab = t.id === "compose";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTab(t.id)}
            aria-pressed={active}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2",
              "transition-colors duration-fast",
              isFab
                ? "text-accent"
                : active
                  ? "text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            <Icon size={isFab ? 20 : 18} />
            <span className="font-sans text-overline uppercase tracking-[0.04em]">
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
