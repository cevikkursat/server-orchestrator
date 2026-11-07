import type { Shape } from "../types";
import type tr from "../tr/deploys";

export default {
  list: {
    descriptionBefore: "The last ",
    descriptionAfter: " deploys across all projects",
    refreshEvery: "Refreshes every {{seconds}}s",
    filterProject: "Filter by project",
    allProjects: "All projects",
    filterStatus: "Filter by status",
    shownOf: "{{shown}} of {{total}} deploys",
    openLog: "Open log",
  },
  filters: {
    all: "All",
    failed: "Failed",
    active: "In progress",
    success: "Succeeded",
  },
  empty: {
    title: "No deploys yet",
    body: "Deploys show up here once you deploy a project.",
  },
  noMatch: {
    title: "No deploys match these filters",
    clear: "Clear filters",
    body: "None of the last {{limit}} deploys match this project and status.",
  },
  table: {
    project: "Project",
    status: "Status",
    source: "Image / commit",
    trigger: "Trigger",
    duration: "Duration",
  },
} satisfies Shape<typeof tr>;
