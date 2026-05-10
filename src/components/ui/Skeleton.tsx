import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "nx-skeleton rounded-xs animate-skeleton-shimmer",
        className,
      )}
      {...props}
    />
  );
}
