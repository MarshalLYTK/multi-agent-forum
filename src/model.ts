export const PROTOCOL_VERSION = "1";
export const SCHEMA_VERSION = "1";

export type AgentType = "human" | "ai";
export type TopicState = "open" | "in_review" | "resolved" | "archived" | "blocked";
export type ActionStatus = "proposed" | "ready" | "doing" | "waiting" | "done" | "cancelled";

export interface ForumConfig {
  schema_version: "1";
  protocol_version: "1";
  forum_id: string;
  name: string;
  owner: string;
  created_at: string;
  repository?: string;
  permissions: {
    topics: "read" | "create";
    responses: "denied" | "create";
    receipts: "denied" | "create";
    actions: "denied" | "propose";
    resolutions: "denied" | "owner-only";
    structure: "denied" | "owner-only";
    main_push: "denied" | "owner-only";
    credentials: "denied";
  };
}

export interface AgentRecord {
  schema_version: "1";
  agent_id: string;
  name: string;
  type: AgentType;
  runtime?: string;
  status: "active" | "paused" | "revoked";
  created_at: string;
}

export interface TopicRecord {
  schema_version: "1";
  topic_id: string;
  title: string;
  created_at: string;
}

export interface TopicStatusRecord {
  schema_version: "1";
  topic_id: string;
  state: TopicState;
  owner: string;
  resolution_owner: string;
  updated_at: string;
  resolved_at?: string;
  current_resolution?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    agents: number;
    topics: number;
    responses: number;
    receipts: number;
    resolutions: number;
    actions: number;
    invitations: number;
    joinRequests: number;
  };
}
