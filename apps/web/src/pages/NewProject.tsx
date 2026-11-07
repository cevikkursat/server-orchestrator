import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Plus, Rocket, X } from "lucide-react";
import type { CreateProjectInput, DomainAccess, EnvVar, ProjectSourceInput, ProjectVolume } from "@panel/shared";
import { AccessEditor } from "../components/AccessUi";
import { api } from "../lib/api";
import { useSettings } from "../lib/projects";
import { EnvEditor } from "../components/ProjectUi";
import { isSourceComplete, SourceFields } from "../components/SourceFields";
import { FormError } from "../components/AuthCard";
import { PageHeader } from "../components/Status";
import { t } from "../i18n";
import { fmtNumber } from "../lib/format";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c]!)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const memoryLabel = (m: number | null) => (m == null ? t("projects:create.summary.unlimitedMemory") : m >= 1024 ? `${m / 1024} GB` : `${m} MB`);

/** "0,5 çekirdek" / "0.5 cores" */
const coresLabel = (c: number) => t("projects:fields.cores", { count: c, n: fmtNumber(c, (String(c).split(".")[1] ?? "").length) });

export function NewProjectPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const base = settings?.baseDomain ?? "localhost";

  const [name, setName] = useState("");
  const [source, setSource] = useState<ProjectSourceInput>({ type: "github" } as ProjectSourceInput);
  const [startCommand, setStartCommand] = useState("");
  const [port, setPort] = useState(3000);
  const [hostname, setHostname] = useState<string | null>(null); // null = isimden türet
  const [redirectWww, setRedirectWww] = useState(false);
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [memoryMb, setMemoryMb] = useState<number | null>(512);
  const [cpus, setCpus] = useState<number | null>(1);
  const [volumes, setVolumes] = useState<ProjectVolume[]>([]);
  const [access, setAccess] = useState<DomainAccess>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveHost = hostname ?? (name ? `${name}.${base}` : "");
  const isApex = effectiveHost === base;
  const sourceOk = isSourceComplete(source);
  const ready = !!name && sourceOk && !!port;
  const missing = t(!sourceOk && !name ? "projects:create.missing.both" : !sourceOk ? "projects:create.missing.source" : !name ? "projects:create.missing.name" : "projects:create.missing.port");
  const sourceSummary =
    source.type === "image" ? source.image || null : source.repoFullName ? `${source.repoFullName}${source.branch ? `@${source.branch}` : ""}` : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: CreateProjectInput = {
        name,
        source,
        startCommand: startCommand.trim() || null,
        port,
        env: env.filter((x) => x.key),
        memoryMb,
        cpus,
        volumes: volumes.filter((v) => v.name || v.path),
        domains: effectiveHost ? [{ hostname: effectiveHost, redirectWww: isApex && redirectWww, access }] : [],
        deploy: true,
      };
      const res = await api.post<{ id: number; deploymentId: number | null }>("/api/projects", body);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${res.id}?deploy=${res.deploymentId ?? ""}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        to="/projects"
        className="-ml-1 mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted transition-colors hover:text-fg max-md:min-h-11"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {t("nav.projects")}
      </Link>
      <PageHeader title={t("projects:list.new")} description={t("projects:create.description")} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,48rem)_18.75rem]">
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <Section n={1} title={t("projects:create.sections.source")}>
            <SourceFields
              value={source}
              onPortHint={setPort}
              onChange={(s) => {
                setSource(s);
                // Repo seçilince proje adını repo adından öner
                if (s.type === "github" && s.repoFullName && !name) setName(slugify(s.repoFullName.split("/")[1] ?? ""));
              }}
            />
          </Section>

          <Section n={2} title={t("projects:create.sections.general")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block">
                  <span className="label">{t("projects:fields.name")}</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(slugify(e.target.value))}
                    placeholder="blog"
                    autoFocus
                    spellCheck={false}
                    autoCapitalize="off"
                    aria-describedby="name-hint"
                  />
                </label>
                <p id="name-hint" className="hint">
                  {t("projects:create.nameHint")}
                </p>
              </div>
              <div>
                <label className="block">
                  <span className="label">{t("projects:fields.internalPort")}</span>
                  <input
                    className="input font-mono"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    aria-describedby="port-hint"
                  />
                </label>
                <p id="port-hint" className="hint">
                  {t("projects:create.portHint")}
                </p>
              </div>
            </div>
            <StartCommandField value={startCommand} onChange={setStartCommand} />
          </Section>

          <Section n={3} title={t("projects:create.sections.domain")}>
            <div>
              <label className="block">
                <span className="label">{t("projects:fields.address")}</span>
                <input
                  className="input font-mono"
                  value={effectiveHost}
                  onChange={(e) => setHostname(e.target.value.trim())}
                  placeholder={t("projects:create.addressPlaceholder", { base })}
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {name && (
                  <button type="button" className="chip font-mono font-normal" onClick={() => setHostname(null)}>
                    {name}.{base}
                  </button>
                )}
                <button type="button" className="chip font-mono font-normal" onClick={() => setHostname(base)}>
                  {t("projects:create.apex", { base })}
                </button>
              </div>
            </div>
            {isApex && (
              <label className="check-row text-fg">
                <input type="checkbox" checked={redirectWww} onChange={(e) => setRedirectWww(e.target.checked)} />
                <span>
                  {t("projects:create.redirectWww.before")}
                  <span className="font-mono">www.{base}</span>
                  {t("projects:create.redirectWww.after")}
                </span>
              </label>
            )}
            <p className="text-xs leading-5 text-muted">
              {t("projects:create.dnsHint.p1")}
              <span className="font-mono text-fg">{base}</span>
              {t("projects:create.dnsHint.p2")}
              <span className="font-mono text-fg">*</span>
              {t("projects:create.dnsHint.p3")}
            </p>
            {effectiveHost && (
              <div>
                <div className="label">{t("projects:domains.accessTitle")}</div>
                <AccessEditor value={access} onChange={setAccess} />
              </div>
            )}
          </Section>

          <Section n={4} title={t("projects:create.sections.env")}>
            <EnvEditor value={env} onChange={setEnv} />
            <p className="text-xs text-muted">{t("projects:create.envEncrypted")}</p>
          </Section>

          <Section n={5} title={t("projects:create.sections.resources")}>
            <ResourceFields memoryMb={memoryMb} cpus={cpus} onMemory={setMemoryMb} onCpus={setCpus} />
            {!(source.type === "github" && source.compose) && <VolumeFields value={volumes} onChange={setVolumes} projectName={name} />}
          </Section>

          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn max-sm:w-full" disabled={busy || !ready}>
              {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
              {busy ? t("projects:create.creating") : t("projects:create.submit")}
            </button>
            <Link to="/projects" className="btn-ghost max-sm:w-full max-sm:justify-center">
              {t("actions.cancel")}
            </Link>
            {!ready && !busy && <span className="text-xs text-muted max-sm:basis-full">{missing}</span>}
          </div>
        </form>

        <aside className="overflow-hidden rounded-lg border border-line bg-raised xl:sticky xl:top-20" aria-label={t("projects:create.summary.label")}>
          <div className="card-head">
            <h2 className="cap">{t("projects:create.summary.label")}</h2>
          </div>
          <dl className="px-4 py-1.5 text-xs sm:px-5">
            <SummaryRow label={t("projects:fields.source")} value={sourceSummary} />
            <SummaryRow label={t("projects:fields.name")} value={name || null} />
            <SummaryRow label={t("projects:fields.address")} value={effectiveHost || null} />
            <SummaryRow label={t("projects:fields.internalPort")} value={port ? String(port) : null} />
            <SummaryRow label={t("projects:create.summary.limit")} value={`${memoryLabel(memoryMb)} · ${cpus == null ? t("projects:create.summary.unlimitedCpu") : coresLabel(cpus)}`} />
          </dl>
          <div className="card-head border-t">
            <h2 className="cap">{t("projects:create.after.title")}</h2>
          </div>
          <ol className="list-decimal space-y-1 py-3 pr-4 pl-9 text-xs leading-5 text-muted sm:pr-5 sm:pl-10">
            <li>{t("projects:create.after.build")}</li>
            <li>{t("projects:create.after.start")}</li>
            <li>{t("projects:create.after.caddy")}</li>
            <li>{t("projects:create.after.log")}</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

/** Numaralı form bölümü */
function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `new-project-s${n}`;
  return (
    <section className="space-y-4 rounded-lg border border-line bg-raised p-4 sm:px-5 sm:pt-[18px] sm:pb-5" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full border border-line font-mono text-[11px] font-medium text-muted" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-soft py-2.5 last:border-b-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-fg" title={value ?? undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function StartCommandField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block">
        <span className="label">
          {t("projects:startCommand.label")} <span className="font-normal text-subtle">{t("projects:startCommand.optional")}</span>
        </span>
        <input
          className="input font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("projects:startCommand.placeholder")}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>
      <p className="hint">
        {t("projects:startCommand.hint")} {t("projects:startCommand.portBefore")}
        <span className="font-mono text-fg">PORT</span>
        {t("projects:startCommand.portAfter")}
      </p>
    </div>
  );
}

/** Kalıcı klasörler: container yolu → deploy'lar arasında korunan volume */
export function VolumeFields({ value, onChange, projectName }: { value: ProjectVolume[]; onChange: (v: ProjectVolume[]) => void; projectName: string }) {
  const set = (i: number, patch: Partial<ProjectVolume>) => onChange(value.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-2">
      <div className="label">{t("projects:volumes.label")}</div>
      {value.map((v, i) => (
        <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
          <input
            className="input w-full font-mono text-xs sm:w-36"
            aria-label={t("projects:volumes.nameLabel")}
            spellCheck={false}
            autoCapitalize="off"
            placeholder={t("projects:volumes.namePlaceholder")}
            value={v.name}
            onChange={(e) => set(i, { name: e.target.value.trim().toLowerCase() })}
          />
          <input
            className="input min-w-0 flex-1 font-mono text-xs"
            aria-label={t("projects:volumes.pathLabel")}
            spellCheck={false}
            autoCapitalize="off"
            placeholder="/app/files"
            value={v.path}
            onChange={(e) => set(i, { path: e.target.value.trim() })}
          />
          <button type="button" className="btn-icon" title={t("projects:remove")} aria-label={t("projects:volumes.removeLabel")} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary btn-sm max-md:min-h-11"
        onClick={() => onChange([...value, { name: value.length ? "" : "data", path: "" }])}
      >
        <Plus className="size-4" aria-hidden /> {t("projects:volumes.add")}
      </button>
      <p className="text-xs leading-5 text-muted">
        {t("projects:volumes.helpBefore")}
        {projectName ? <span className="font-mono text-fg">{t("projects:volumes.helpNamed", { name: projectName })}</span> : t("projects:volumes.helpGeneric")}
        {t("projects:volumes.helpAfter")}
      </p>
    </div>
  );
}

export function ResourceFields(props: {
  memoryMb: number | null;
  cpus: number | null;
  onMemory: (v: number | null) => void;
  onCpus: (v: number | null) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="block">
          <span className="label">{t("projects:resources.memory")}</span>
          <select className="input" value={props.memoryMb ?? ""} onChange={(e) => props.onMemory(e.target.value ? Number(e.target.value) : null)}>
            {[128, 256, 512, 1024, 2048, 4096].map((m) => (
              <option key={m} value={m}>
                {m >= 1024 ? `${m / 1024} GB` : `${m} MB`}
              </option>
            ))}
            <option value="">{t("projects:resources.unlimited")}</option>
          </select>
        </label>
      </div>
      <div>
        <label className="block">
          <span className="label">{t("projects:resources.cpu")}</span>
          <select className="input" value={props.cpus ?? ""} onChange={(e) => props.onCpus(e.target.value ? Number(e.target.value) : null)}>
            {[0.25, 0.5, 1, 2, 4].map((c) => (
              <option key={c} value={c}>
                {coresLabel(c)}
              </option>
            ))}
            <option value="">{t("projects:resources.unlimited")}</option>
          </select>
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted sm:col-span-2">{t("projects:resources.hint")}</p>
    </div>
  );
}
