import { useQuery } from "@tanstack/react-query";
import type { BackupEntry, BackupSettings, CronJob, DatabaseInfo, NotificationSettings } from "@panel/shared";
import { api } from "./api";

export const useDatabases = () =>
  useQuery({ queryKey: ["databases"], queryFn: () => api.get<DatabaseInfo[]>("/api/databases"), refetchInterval: 5000 });

export const useBackups = () =>
  useQuery({
    queryKey: ["backups"],
    queryFn: () =>
      api.get<{ backups: BackupEntry[]; settings: BackupSettings; nextRunAt: number | null; directory: string }>("/api/backups"),
    refetchInterval: (q) =>
      q.state.data?.backups.some((b) => b.status === "running" || b.remoteStatus === "pending" || b.remoteStatus === "uploading") ? 1500 : 10000,
  });

export const useCronJobs = (projectId: number) =>
  useQuery({
    queryKey: ["cron", projectId],
    queryFn: () => api.get<CronJob[]>(`/api/projects/${projectId}/cron`),
    refetchInterval: 5000,
  });

export const useNotifications = () =>
  useQuery({ queryKey: ["notifications"], queryFn: () => api.get<NotificationSettings>("/api/notifications") });

export function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}
