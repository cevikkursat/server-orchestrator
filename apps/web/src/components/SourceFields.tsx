import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Box, Lock, Search } from "lucide-react";
import { Github } from "./GithubIcon";
import type { GithubRepo, ProjectSourceInput } from "@panel/shared";
import { useGithubBranches, useGithubRepos, useGithubStatus } from "../lib/github";
import { t } from "../i18n";

type GithubInput = Extract<ProjectSourceInput, { type: "github" }>;

export const emptyImageSource: ProjectSourceInput = { type: "image", image: "" };

/** Kaynak seçimi: GitHub reposu veya hazır Docker image */
export function SourceFields({
  value,
  onChange,
  onPortHint,
}: {
  value: ProjectSourceInput;
  onChange: (v: ProjectSourceInput) => void;
  onPortHint?: (port: number) => void;
}) {
  const tab = (kind: "github" | "image", label: string, Icon: (p: { className?: string }) => React.ReactNode) => (
    <button
      type="button"
      aria-pressed={value.type === kind}
      onClick={() => value.type !== kind && onChange(kind === "image" ? emptyImageSource : ({ type: "github" } as ProjectSourceInput))}
      className="inline-flex flex-1 items-center justify-center gap-2"
    >
      <Icon className="size-4" /> {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="segmented" role="group" aria-label={t("projects:source.typeLabel")}>
        {tab("github", t("projects:source.github"), Github)}
        {tab("image", t("projects:source.image"), Box)}
      </div>
      {value.type === "image" ? (
        <div>
          <label className="block">
<span className="label">{t("projects:source.image")}</span>
          <input
            className="input font-mono"
            value={value.image}
            onChange={(e) => onChange({ type: "image", image: e.target.value.trim() })}
            placeholder={t("projects:source.imagePlaceholder")}
          />
</label>
          {onPortHint && (
            <p className="hint">
              {t("projects:source.tryIt")}{" "}
              <button
                type="button"
                className="link font-mono"
                onClick={() => {
                  onChange({ type: "image", image: "traefik/whoami" });
                  onPortHint(80);
                }}
              >
                traefik/whoami
              </button>{" "}
              {t("projects:source.port80")}
            </p>
          )}
        </div>
      ) : (
        <GithubFields value={value as GithubInput} onChange={onChange} />
      )}
    </div>
  );
}

function GithubFields({ value, onChange }: { value: GithubInput; onChange: (v: ProjectSourceInput) => void }) {
  const { data: status, isLoading: statusLoading } = useGithubStatus();
  const ready = !!status?.configured && status.installations.length > 0;
  const { data: repos, isLoading: reposLoading, error: reposError } = useGithubRepos(ready);
  const { data: branches } = useGithubBranches(value.installationId ?? null, value.repoFullName ?? null);
  const [q, setQ] = useState("");
  const [advanced, setAdvanced] = useState(!!(value.rootDir || value.dockerfilePath || value.watchPaths?.length));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (repos ?? []).filter((r) => !s || r.fullName.toLowerCase().includes(s)).slice(0, 50);
  }, [repos, q]);

  const set = (patch: Partial<GithubInput>) => onChange({ ...value, ...patch, type: "github" } as ProjectSourceInput);

  // Varsayılan branch'i, liste gelince ve seçili değilse ata
  useEffect(() => {
    if (value.repoId && !value.branch) {
      const r = repos?.find((x) => x.id === value.repoId);
      if (r) set({ branch: r.defaultBranch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, value.repoId]);

  if (statusLoading) return <p className="text-sm text-subtle">{t("projects:source.loading")}</p>;
  if (!status?.configured || !ready) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted sm:p-5">
        {!status?.configured ? t("projects:source.notConfigured") : t("projects:source.noAccess")} {t("projects:source.connectBefore")}
        <Link to="/settings" className="link">
          {t("projects:source.settingsLink")}
        </Link>
        {t("projects:source.connectAfter")}
      </div>
    );
  }

  const selectRepo = (r: GithubRepo) =>
    set({ installationId: r.installationId, repoId: r.id, repoFullName: r.fullName, branch: r.defaultBranch });

  return (
    <div className="space-y-4">
      {value.repoId ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/[0.05] py-1 pr-1 pl-3">
          <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
            <Github className="size-4 shrink-0 text-muted" /> <span className="truncate">{value.repoFullName}</span>
          </span>
          <button type="button" className="btn-ghost btn-sm max-md:min-h-11" onClick={() => set({ repoId: undefined, repoFullName: undefined, branch: undefined })}>
            {t("projects:source.change")}
          </button>
        </div>
      ) : (
        <div>
          <label htmlFor="repo-search" className="label">
            {t("projects:source.repo")}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <input id="repo-search" type="search" className="input pl-9" placeholder={t("projects:source.searchRepo")} spellCheck={false} autoCapitalize="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-2 max-h-60 overflow-auto rounded-md border border-line bg-canvas">
            {reposLoading && <div className="p-3 text-sm text-subtle">{t("projects:source.reposLoading")}</div>}
            {reposError && <div className="p-3 text-sm text-danger">{(reposError as Error).message}</div>}
            {filtered.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => selectRepo(r)}
                className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-line-soft px-3 text-left last:border-0 hover:bg-fg/[0.03] md:min-h-10"
              >
                <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-fg">
                  <Github className="size-3.5 shrink-0 text-faint" /> <span className="truncate">{r.fullName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-faint">
                  {r.private && <Lock className="size-3.5" aria-label={t("projects:source.privateRepo")} />}
                  {r.defaultBranch}
                </span>
              </button>
            ))}
            {repos && filtered.length === 0 && <div className="p-3 text-sm text-subtle">{t("projects:source.noMatch")}</div>}
          </div>
          <p className="hint">
            {t("projects:source.missingBefore")}
            <Link to="/settings" className="link">
              {t("projects:source.missingLink")}
            </Link>
            {t("projects:source.missingAfter")}
          </p>
        </div>
      )}

      {value.repoId && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block">
<span className="label">{t("projects:source.branch")}</span>
              <select className="input" value={value.branch ?? ""} onChange={(e) => set({ branch: e.target.value })}>
                {!branches && value.branch && <option>{value.branch}</option>}
                {branches?.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
</label>
            </div>
            <label className="check-row self-end text-fg">
              <input type="checkbox" checked={value.autoDeploy ?? true} onChange={(e) => set({ autoDeploy: e.target.checked })} />
              {t("projects:source.autoDeploy")}
            </label>
          </div>

          <div className="segmented" role="group" aria-label={t("projects:source.runMode")}>
            {(
              [
                [false, "single"],
                [true, "compose"],
              ] as const
            ).map(([isCompose, mode]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={!!value.compose === isCompose}
                onClick={() => set({ compose: isCompose ? (value.compose ?? { file: "docker-compose.yml", service: "" }) : null })}
                className="flex-1 leading-tight whitespace-normal"
              >
                {t(`projects:source.${mode}`)}
              </button>
            ))}
          </div>

          {value.compose ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block">
<span className="label">{t("projects:source.composeFile")}</span>
                <input
                  className="input font-mono"
                  value={value.compose.file ?? ""}
                  onChange={(e) => set({ compose: { ...value.compose!, file: e.target.value.trim() } })}
                  placeholder="docker-compose.yml"
                />
</label>
              </div>
              <div>
                <label className="block">
<span className="label">{t("projects:source.composeService")}</span>
                <input
                  className="input font-mono"
                  value={value.compose.service ?? ""}
                  onChange={(e) => set({ compose: { ...value.compose!, service: e.target.value.trim() } })}
                  placeholder="web"
                />
</label>
              </div>
              <div>
                <label className="block">
<span className="label">{t("projects:source.rootDir")}</span>
                <input className="input font-mono" placeholder={t("projects:source.rootPlaceholder")} value={value.rootDir ?? ""} onChange={(e) => set({ rootDir: e.target.value.trim() })} />
</label>
              </div>
              <p className="-mt-2 text-xs text-muted sm:col-span-2">
                {t("projects:source.composeHint.p1")}
                <span className="font-mono">docker compose up -d --build</span>
                {t("projects:source.composeHint.p2")}
                <span className="font-mono">ports:</span>
                {t("projects:source.composeHint.p3")}
              </p>
              <WatchPaths value={value.watchPaths ?? []} onChange={(watchPaths) => set({ watchPaths })} />
            </div>
          ) : advanced ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block">
<span className="label">{t("projects:source.rootDir")}</span>
                <input className="input font-mono" placeholder={t("projects:source.rootPlaceholder")} value={value.rootDir ?? ""} onChange={(e) => set({ rootDir: e.target.value.trim() })} />
</label>
              </div>
              <div>
                <label className="block">
<span className="label">{t("projects:source.dockerfile")}</span>
                <input className="input font-mono" placeholder={t("projects:source.autoPlaceholder")} value={value.dockerfilePath ?? ""} onChange={(e) => set({ dockerfilePath: e.target.value.trim() })} />
</label>
              </div>
              <p className="-mt-2 text-xs text-muted sm:col-span-2">
                {t("projects:source.autoDetectHint")}
              </p>
              <WatchPaths value={value.watchPaths ?? []} onChange={(watchPaths) => set({ watchPaths })} />
            </div>
          ) : (
            <button type="button" className="btn-ghost btn-sm -ml-2 self-start max-md:min-h-11" aria-expanded={false} onClick={() => setAdvanced(true)}>
              {t("projects:source.advanced")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Monorepo: sadece bu klasörler değişince otomatik deploy */
function WatchPaths({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <div className="sm:col-span-2">
      <label className="block">
<span className="label">{t("projects:source.watchPaths")}</span>
      <textarea
        className="input min-h-20 font-mono text-xs"
        value={text}
        placeholder={"apps/api\npackages/db\npackages/shared\npnpm-lock.yaml"}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split("\n")
              .map((l) => l.trim().replace(/^\.?\//, "").replace(/\/+$/, ""))
              .filter(Boolean),
          );
        }}
      />
</label>
      <p className="hint">
        {t("projects:source.watchHint")}
      </p>
    </div>
  );
}

export function isSourceComplete(s: ProjectSourceInput) {
  if (s.type === "image") return !!s.image;
  return !!(s.repoId && s.installationId && s.repoFullName && s.branch && (!s.compose || (s.compose.service && s.compose.file)));
}
