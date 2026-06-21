import { registerModule, type ModuleManifest } from "@/modules/registry";
import { localStore } from "@/storage/local";
import { useWorkspace } from "@/state/workspace";
import { NOTES_MAIN_PANEL_KEY } from "@/modules/notes";
import { summarizeThread } from "@/modules/ai/summarizeThread";

export const AI_MODULE_ID = "org.nexus.ai";

const manifest: ModuleManifest = {
  id: AI_MODULE_ID,
  name: "AI",
  version: "0.1.0",
  namespace: AI_MODULE_ID,
  entities: [],
  mutationKinds: [],
  capabilities: { "ui.contribute": ["command"] },
  trust: "core",
  contributes: {
    commands: [{ id: "summarize-thread", title: "Summarize this thread with AI", icon: "sparkles" }],
  },
};

/** Run the summarize flow against the currently-selected email; surface errors as a toast + open Notes on success. */
export async function runSummarizeSelectedThread(): Promise<void> {
  const { toast } = await import("sonner");
  const messageId = useWorkspace.getState().selectedEmailId;
  if (!messageId) {
    toast.error("Select an email first");
    return;
  }
  try {
    await summarizeThread(messageId, localStore);
    useWorkspace.getState().openModulePanel(NOTES_MAIN_PANEL_KEY, "Notes");
    toast.success("AI summary created");
  } catch (e) {
    toast.error(`Couldn't summarize: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function registerAiModule(): () => void {
  return registerModule(manifest, (host) => {
    host.contribute.command("summarize-thread", () => {
      void runSummarizeSelectedThread();
    });
  });
}
