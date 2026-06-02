import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { cn, initials } from "@/lib/utils";
import type { PanelLink } from "@/design-system/tokens";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: number;
  colorSeed?: PanelLink;
  src?: string;
  /**
   * When provided, Avatar tries Gravatar (SHA-256 of the lowercased email, `d=404`)
   * and a domain favicon (DuckDuckGo) as additional fallbacks before showing initials.
   */
  email?: string;
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

const gravatarHashCache = new Map<string, string>();

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function useGravatarHash(email: string | undefined): string | undefined {
  const normalized = useMemo(
    () => (email ? email.toLowerCase().trim() : undefined),
    [email],
  );
  const [hash, setHash] = useState<string | undefined>(() =>
    normalized ? gravatarHashCache.get(normalized) : undefined,
  );

  useEffect(() => {
    if (!normalized) {
      setHash(undefined);
      return;
    }
    const cached = gravatarHashCache.get(normalized);
    if (cached) {
      setHash(cached);
      return;
    }
    let cancelled = false;
    sha256Hex(normalized)
      .then((h) => {
        if (cancelled) return;
        gravatarHashCache.set(normalized, h);
        setHash(h);
      })
      .catch(() => {
        // crypto.subtle unavailable — silently skip Gravatar fallback
      });
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return hash;
}

export function Avatar({
  name,
  size = 20,
  colorSeed = 8,
  src,
  email,
  className,
  style,
  ...props
}: AvatarProps) {
  const gravatarHash = useGravatarHash(email);

  const candidates = useMemo(() => {
    const list: string[] = [];
    if (src) list.push(src);
    if (gravatarHash) {
      list.push(`https://gravatar.com/avatar/${gravatarHash}?d=404&s=128`);
    }
    const domain = email?.split("@")[1]?.toLowerCase();
    if (domain) {
      list.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
    }
    return list;
  }, [src, gravatarHash, email]);

  const [errorIdx, setErrorIdx] = useState(0);

  // Reset to first candidate whenever the source list changes (e.g. hash resolves).
  useEffect(() => {
    setErrorIdx(0);
  }, [candidates]);

  const inits = initials(name);
  const single = size <= 20;
  const hue = COLOR_VAR[colorSeed];
  const currentSrc = candidates[errorIdx];
  const showImg = !!currentSrc;

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
          key={currentSrc}
          src={currentSrc}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setErrorIdx((i) => i + 1)}
        />
      ) : single ? (
        inits[0]
      ) : (
        inits
      )}
    </div>
  );
}
