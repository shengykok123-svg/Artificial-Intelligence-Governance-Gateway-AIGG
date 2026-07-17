// M6  Entry. TanStack Query provider. MSW started in dev.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

async function enableMockingIfRequested(): Promise<void> {
  // VITE_USE_MSW is the offline fallback, never the default: MSW starts
  // only when explicitly opted into, same shape as M4's mock.ts.
  if (import.meta.env.VITE_USE_MSW !== "true") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

enableMockingIfRequested().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
