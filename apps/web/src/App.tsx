import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuthStatus } from "./lib/auth";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { SetupPage } from "./pages/Setup";
import { DashboardPage } from "./pages/Dashboard";
import { t } from "./i18n";

// Diğer sayfalar açıldıklarında yüklenir (ilk açılış hızlı olsun)
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const SettingsPage = page(() => import("./pages/Settings"), "SettingsPage");
const ContainersPage = page(() => import("./pages/Containers"), "ContainersPage");
const ContainerDetailPage = page(() => import("./pages/ContainerDetail"), "ContainerDetailPage");
const ProjectsPage = page(() => import("./pages/Projects"), "ProjectsPage");
const NewProjectPage = page(() => import("./pages/NewProject"), "NewProjectPage");
const ProjectDetailPage = page(() => import("./pages/ProjectDetail"), "ProjectDetailPage");
const DeploymentsPage = page(() => import("./pages/Deployments"), "DeploymentsPage");
const DatabasesPage = page(() => import("./pages/Databases"), "DatabasesPage");
const DatabaseExplorerPage = page(() => import("./pages/DatabaseExplorer"), "DatabaseExplorerPage");
const BackupsPage = page(() => import("./pages/Backups"), "BackupsPage");
const DomainsPage = page(() => import("./pages/Domains"), "DomainsPage");
const SecurityPage = page(() => import("./pages/Security"), "SecurityPage");
const EnvGroupsPage = page(() => import("./pages/EnvGroups"), "EnvGroupsPage");

export function App() {
  const { data, isLoading, error } = useAuthStatus();

  if (isLoading) return <div className="grid min-h-screen place-items-center text-subtle">{t("states.loadingEllipsis")}</div>;
  if (error || !data) return <div className="grid min-h-screen place-items-center text-danger">{t("errors.apiUnreachable")}</div>;

  if (data.setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!data.authenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<div className="p-8 text-sm text-subtle">{t("states.loadingEllipsis")}</div>}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="containers" element={<ContainersPage />} />
          <Route path="containers/:id" element={<ContainerDetailPage />} />
          <Route path="deployments" element={<DeploymentsPage />} />
          <Route path="databases" element={<DatabasesPage />} />
          <Route path="databases/:id/data" element={<DatabaseExplorerPage />} />
          <Route path="domains" element={<DomainsPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="env-groups" element={<EnvGroupsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
