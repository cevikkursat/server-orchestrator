import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { AuthStatus } from "@panel/shared";
import { api } from "./api";

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<AuthStatus>("/api/auth/status"),
    staleTime: 30_000,
  });
}

/** Arayüzü "çıkış yapılmış" duruma getirir: diğer önbellekleri siler, App giriş ekranına yönlendirir. */
export function markLoggedOut(qc: QueryClient) {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth-status" });
  qc.setQueryData<AuthStatus>(["auth-status"], { setupRequired: false, authenticated: false, user: null });
}
