import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@/data/fixtures"; // seeds localStore with fixture data on startup
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
