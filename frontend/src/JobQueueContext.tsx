import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  cancelJob as cancelJobApi,
  enqueueJob as enqueueJobApi,
  fetchJobs,
  fetchQueueConfig,
  resumeJob as resumeJobApi,
  saveQueueConfig,
} from "./api";
import type { Job, QueueSettings } from "./jobTypes";

type JobQueueContextValue = {
  jobs: Job[];
  recent: Job[];
  settings: QueueSettings;
  running: number;
  queued: number;
  refresh: () => Promise<void>;
  enqueue: (body: {
    projectId: string;
    kind: string;
    payload?: Record<string, unknown>;
    label?: string;
  }) => Promise<Job>;
  cancel: (jobId: string) => Promise<void>;
  resume: (jobId: string) => Promise<void>;
  updateSettings: (s: QueueSettings) => Promise<void>;
  activeJobs: Job[];
  jobForProject: (projectId: string | null) => Job | undefined;
};

const JobQueueContext = createContext<JobQueueContextValue | null>(null);

export function JobQueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recent, setRecent] = useState<Job[]>([]);
  const [settings, setSettings] = useState<QueueSettings>({
    maxConcurrentJobs: 2,
    maxConcurrentProjects: 5,
  });
  const [running, setRunning] = useState(0);
  const [queued, setQueued] = useState(0);

  const refresh = useCallback(async () => {
    const [list, cfg] = await Promise.all([fetchJobs(), fetchQueueConfig()]);
    setJobs(list.active);
    setRecent(list.recent);
    setSettings(list.summary.settings ?? cfg);
    setRunning(list.summary.running ?? 0);
    setQueued(list.summary.queued ?? 0);
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
    const t = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const enqueue = useCallback(
    async (body: {
      projectId: string;
      kind: string;
      payload?: Record<string, unknown>;
      label?: string;
    }) => {
      const { job } = await enqueueJobApi(body);
      await refresh();
      return job;
    },
    [refresh]
  );

  const cancel = useCallback(
    async (jobId: string) => {
      await cancelJobApi(jobId);
      await refresh();
    },
    [refresh]
  );

  const resume = useCallback(
    async (jobId: string) => {
      await resumeJobApi(jobId);
      await refresh();
    },
    [refresh]
  );

  const updateSettings = useCallback(
    async (s: QueueSettings) => {
      const { settings: saved } = await saveQueueConfig(s);
      setSettings(saved);
      await refresh();
    },
    [refresh]
  );

  const activeJobs = useMemo(
    () =>
      jobs.filter((j) =>
        ["queued", "running", "waiting_input"].includes(j.status)
      ),
    [jobs]
  );

  const jobForProject = useCallback(
    (projectId: string | null) => {
      if (!projectId) return undefined;
      return activeJobs.find((j) => j.projectId === projectId);
    },
    [activeJobs]
  );

  const value = useMemo(
    () => ({
      jobs,
      recent,
      settings,
      running,
      queued,
      refresh,
      enqueue,
      cancel,
      resume,
      updateSettings,
      activeJobs,
      jobForProject,
    }),
    [
      jobs,
      recent,
      settings,
      running,
      queued,
      refresh,
      enqueue,
      cancel,
      resume,
      updateSettings,
      activeJobs,
      jobForProject,
    ]
  );

  return (
    <JobQueueContext.Provider value={value}>{children}</JobQueueContext.Provider>
  );
}

export function useJobQueue(): JobQueueContextValue {
  const ctx = useContext(JobQueueContext);
  if (!ctx) throw new Error("useJobQueue requires JobQueueProvider");
  return ctx;
}