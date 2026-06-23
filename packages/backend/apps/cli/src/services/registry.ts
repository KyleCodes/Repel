import type { RunnableApp } from '@repel/backend-runtime/application';

// Maps a service name to a lazy loader for that app's RunnableApp.
type ServiceLoader = () => Promise<RunnableApp>;

const services: Record<string, ServiceLoader> = {
  api: () => import('@repel/backend-api/start').then((m) => m.apiApp),
};

export function serviceNames(): string[] {
  return Object.keys(services);
}

export function resolveService(name: string): ServiceLoader | undefined {
  return services[name];
}
