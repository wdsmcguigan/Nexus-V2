import { useMemo } from "react";
import { localStore } from "@/storage/local";
import { useStoreVersion } from "@/storage/useStore";
import { sortNotesByUpdated } from "@/modules/notes/noteSort";
import type { Note } from "@/data/types";

/** All notes, sorted by last-updated desc. */
export function useNotes(): Note[] {
  const v = useStoreVersion();
  return useMemo(() => sortNotesByUpdated(Array.from(localStore.notes.values())), [v]);
}

/** A single note by id (reactive), or undefined. */
export function useNote(id: string): Note | undefined {
  const v = useStoreVersion();
  return useMemo(() => localStore.notes.get(id), [v, id]);
}
