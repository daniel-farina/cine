import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./theme";
import { JobQueueProvider } from "./JobQueueContext";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <JobQueueProvider>
      <App />
    </JobQueueProvider>
  </StrictMode>
);