import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelEmptyProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Empty panel placeholder — see spec §4.6. */
export function PanelEmpty({
  icon: Icon,
  title,
  body,
  action,
  className,
}: PanelEmptyProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center px-6 text-center",
        // density via container queries
        "@[240px]:py-6 @[480px]:py-16",
        className,
      )}
    >
      <Icon size={32} aria-hidden className="text-text-tertiary" />
      <h3 className="mt-3 text-h3 font-semibold text-text-secondary">{title}</h3>
      {body && (
        <p className="mt-1 max-w-[280px] text-small text-text-tertiary">
          {body}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
