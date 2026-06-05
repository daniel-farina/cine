import type { CreateAllProgress } from "./createAllTypes";

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "done"
  | "error"
  | "cancelled";

export type Job = {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: string;
  status: JobStatus;
  progress: number;
  label: string;
  payload?: Record<string, unknown>;
  progressDetail?: CreateAllProgress | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type QueueSettings = {
  maxConcurrentJobs: number;
  maxConcurrentProjects: number;
};

export type QueueSummary = {
  settings: QueueSettings;
  running: number;
  runningProjects: number;
  queued: number;
  jobs: Job[];
};