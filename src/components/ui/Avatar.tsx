import * as React from "react";
import { useState } from "react";
import { cn, initials } from "@/lib/utils";
import type { PanelLink } from "@/design-system/tokens";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: number;
  colorSeed?: PanelLink;
  src?: string;
}

const COLOR_VAR: Record<PanelLink, string> = {
  1: "var(--color-link-1)",   2: "var(--color-link-2)",   3: "var(--color-link-3)",
  4: "var(--color-link-4)",   5: "var(--color-link-5)",   6: "var(--color-link-6)",
  7: "var(--color-link-7)",   8: "var(--color-link-8)",   9: "var(--color-link-9)",
  10: "var(--color-link-10)", 11: "var(--color-link-11)", 12: "var(--color-link-12)",
  13: "var(--color-link-13)", 14: "var(--color-link-14)", 15: "var(--color-link-15)",
  16: "var(--color-link-16)", 17: "var(--color-link-17)", 18: "var(--color-link-18)",
  19: "var(--color-link-19)", 20: "var(--color-link-20)", 21: "var(--color-link-21)",
};

export function Avatar({
  name,
  size = 20,
  colorSeed = 8,
  src,
  className,
  style,
  ...props
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const inits = initials(name);
  const single = size <= 20;
  const hue = COLOR_VAR[colorSeed];
  const showImg = src && !imgFailed;
  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        "shrink-0 rounded-full overflow-hidden flex items-center justify-center font-sans font-semibold",
        "text-text-on-accent",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.floor(size * 0.42)),
        backgroundColor: showImg ? "var(--color-surface-3)" : hue,
        ...style,
      }}
      {...props}
    >
      {showImg ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : single ? (
        inits[0]
      ) : (
        inits
      )}
    </div>
  );
}
