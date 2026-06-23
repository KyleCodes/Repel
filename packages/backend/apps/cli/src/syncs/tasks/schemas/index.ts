import { z } from 'zod';

// `syncs tasks` read verbs. All org-scoped (env fallback). `list` takes the
// parent job id; `show`/`events` take both job and task ids for REST-path
// symmetry (GET /syncs/{id}/tasks/{id}[/events]) — the handler validates the
// task belongs to the job.
export const TasksListInputSchema = z.object({
  org: z.string().optional(),
  jobId: z.string().min(1, 'jobId is required'),
});
export type TasksListInput = z.infer<typeof TasksListInputSchema>;

export const TasksShowInputSchema = z.object({
  org: z.string().optional(),
  jobId: z.string().min(1, 'jobId is required'),
  taskId: z.string().min(1, 'taskId is required'),
});
export type TasksShowInput = z.infer<typeof TasksShowInputSchema>;

export const TasksEventsInputSchema = z.object({
  org: z.string().optional(),
  jobId: z.string().min(1, 'jobId is required'),
  taskId: z.string().min(1, 'taskId is required'),
});
export type TasksEventsInput = z.infer<typeof TasksEventsInputSchema>;
