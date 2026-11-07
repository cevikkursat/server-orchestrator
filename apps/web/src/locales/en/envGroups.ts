import type { Shape } from "../types";
import type tr from "../tr/envGroups";

export default {
  page: {
    descriptionBefore: "Define values shared across projects (SMTP, API keys…) once, then link them from a project's ",
    descriptionTab: "Environment variables",
    descriptionAfter: " tab.",
    newGroup: "New group",
    emptyTitle: "No groups yet",
    emptyBody: "For example, create a group called \"smtp\" and add SMTP_HOST, SMTP_USER and SMTP_PASS.",
  },
  card: {
    saved: "Saved.",
    savedRedeploy: "Saved. Linked projects pick up the new values on their next deploy.",
    redeployConfirm: {
      title: "Redeploy linked projects?",
      confirm: "Deploy",
    },
    redeployStarted_one: "Deploy started for {{count}} project.",
    redeployStarted_other: "Deploy started for {{count}} projects.",
    removeConfirm: {
      title: "Delete group \"{{name}}\"?",
      message: "Linked projects ({{projects}}) will lose these values on their next deploy.",
    },
    vars_one: " variable · last changed {{ago}}",
    vars_other: " variables · last changed {{ago}}",
    removeGroup: "Delete group",
    removeNamed: "Delete group {{name}}",
    closeNew: "Close new group",
    name: "Group name",
    variables: "Variables",
    create: "Create group",
    empty: "(empty)",
    noVars: "This group has no variables.",
    usedBy: "Used by",
    unusedBefore: "Not linked to any project yet. Link it from a project's ",
    unusedTab: "Environment variables",
    unusedAfter: " tab.",
    redeploy: "Redeploy linked projects",
  },
} satisfies Shape<typeof tr>;
