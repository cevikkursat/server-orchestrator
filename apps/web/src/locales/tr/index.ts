import common from "./common";
import dashboard from "./dashboard";
import projects from "./projects";
import domains from "./domains";
import databases from "./databases";
import deploys from "./deploys";
import containers from "./containers";
import envGroups from "./envGroups";
import backups from "./backups";
import security from "./security";
import settings from "./settings";
import auth from "./auth";

/** Türkçe kaynak: anahtarların tek doğru listesi */
export const tr = {
  common,
  dashboard,
  projects,
  domains,
  databases,
  deploys,
  containers,
  envGroups,
  backups,
  security,
  settings,
  auth,
};
export type Messages = typeof tr;
