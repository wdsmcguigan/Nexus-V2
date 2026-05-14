import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@/data/fixtures"; // seeds localStore + bodyStore + ftsIndex synchronously
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { ftsIndex } from "@/storage/fts";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After first render: initialize OPFS persistence.
// If a saved snapshot loads (return visit), re-build FTS index from the
// persisted messages so search covers the user's actual data, not just fixtures.
localStore.initOpfs().then((loadedFromOpfs) => {
  if (loadedFromOpfs) {
    const messages = Array.from(localStore.messages.values());
    ftsIndex.indexMessages(messages, bodyStore);
  }
});
