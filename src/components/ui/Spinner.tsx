import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({
  size = 14,
  className,
  ...props
}: { size?: number } & React.HTMLAttributes<SVGSVGElement>) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      width={size}
      height={size}
      className={cn("animate-spin text-text-tertiary", className)}
      {...props}
    />
  );
}
