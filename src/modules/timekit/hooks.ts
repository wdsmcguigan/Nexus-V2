import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";

/** The saved Clock timezone list (reactive). */
export function useTimekitZones(): string[] {
  const v = useStoreVersion();
  return useMemo(() => localStore.timekitZones, [v]);
}
