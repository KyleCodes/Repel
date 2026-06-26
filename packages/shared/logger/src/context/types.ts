export interface LogContext {
  service?: string;
  traceId?: string;
  [k: string]: unknown;
}
