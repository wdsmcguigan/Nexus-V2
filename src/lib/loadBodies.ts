import type { Message } from "@/data/types";
import { bodyStore } from "@/storage/bodyStore";
import { isTauri, getMessageBody } from "@/storage/tauri";

/**
 * Loads body HTML for all provided messages.
 * Returns a Map<bodyRef, html> — misses fall back to snippet.
 */
export async function loadBodies(messages: Message[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const missing: Message[] = [];
  for (const msg of messages) {
    const cached = bodyStore.get(msg.bodyRef);
    if (cached) {
      result.set(msg.bodyRef, cached);
    } else {
      result.set(msg.bodyRef, `<p>${msg.snippet}</p>`); // fallback
      missing.push(msg);
    }
  }

  if (isTauri() && missing.length > 0) {
    await Promise.all(
      missing.map(async (msg) => {
        const html = await getMessageBody(msg.bodyRef).catch(() => null);
        if (html) {
          bodyStore.set(msg.bodyRef, html);
          result.set(msg.bodyRef, html);
        }
      }),
    );
  }

  return result;
}
