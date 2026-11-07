import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthStatus } from "@panel/shared";
import "./i18n";
import { LanguageRoot } from "./components/LanguageRoot";
import { App } from "./App";
import { ApiError } from "./lib/api";
import { markLoggedOut } from "./lib/auth";
import { DialogHost } from "./lib/dialog";
import { ToastHost } from "./lib/toast";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

// Oturum sunucuda bittiyse (süre doldu / başka yerden kapatıldı) herhangi bir istek 401 döner:
// arayüzü giriş ekranına düşür.
function onApiError(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  const status = queryClient.getQueryData<AuthStatus>(["auth-status"]);
  if (status?.authenticated) markLoggedOut(queryClient);
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LanguageRoot>
          <App />
        </LanguageRoot>
        <DialogHost />
        <ToastHost />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
