import { useQuery } from "@tanstack/react-query";
import type { GithubRepo, GithubStatus, ProjectSource } from "@panel/shared";
import { api } from "./api";

export const useGithubStatus = () =>
  useQuery({ queryKey: ["github", "status"], queryFn: () => api.get<GithubStatus>("/api/github/status") });

export const useGithubRepos = (enabled: boolean) =>
  useQuery({ queryKey: ["github", "repos"], queryFn: () => api.get<GithubRepo[]>("/api/github/repos"), enabled, staleTime: 60_000 });

export const useGithubBranches = (installationId: number | null, repo: string | null) =>
  useQuery({
    queryKey: ["github", "branches", installationId, repo],
    queryFn: () => api.get<string[]>(`/api/github/branches?installationId=${installationId}&repo=${encodeURIComponent(repo!)}`),
    enabled: !!installationId && !!repo,
    staleTime: 60_000,
  });

export function sourceLabel(s: ProjectSource) {
  if (s.type !== "github") return s.image;
  return `${s.repoFullName}@${s.branch}${s.rootDir ? `/${s.rootDir}` : ""}${s.compose ? ` · compose:${s.compose.service}` : ""}`;
}

/** GitHub manifest formunu oluşturup GitHub'a gönderir (tam sayfa yönlendirme) */
export async function startGithubAppCreation() {
  const r = await api.post<{ url: string; manifest: string }>("/api/github/manifest", { origin: window.location.origin });
  const form = document.createElement("form");
  form.method = "POST";
  form.action = r.url;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = r.manifest;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
