import type { Command } from 'commander';
import { closeDb as defaultCloseDb } from '@repel/backend-db/runtime';
import type { RunnableApp } from '@repel/backend-runtime/application';
import { logger } from '@repel/logger/logger';
import { parseOrExit } from '../lib/parse-or-exit';
import { UnknownServiceError } from './error';
import {
  resolveService as defaultResolveService,
  serviceNames as defaultServiceNames,
} from './registry';
import { type ServicesRunInput, ServicesRunInputSchema } from './schemas/index';

// `services run <name>` boots one app in-process; `--all` boots every registered
// app in one process (one event loop, one debugger).

export function registerServicesCommands(program: Command): void {
  const services = program
    .command('services')
    .description('Run backend services (apps) in-process');

  services
    .command('run [name]')
    .description('Boot one service by name, or every service with --all')
    .option('--all', 'boot every registered service in one process')
    .action(async function (name: string | undefined, opts: { all?: boolean }) {
      const input = parseOrExit(ServicesRunInputSchema, {
        name,
        all: opts.all,
      });
      await runServicesRun(input);
    });
}

// Injectable seams so tests can drive runServicesRun without a real registry,
// pool, or signal wait. Production passes nothing.
export interface ServicesRunDeps {
  resolveService?: typeof defaultResolveService;
  serviceNames?: typeof defaultServiceNames;
  closeDb?: typeof defaultCloseDb;
  waitForShutdown?: (
    apps: RunnableApp[],
    closeDb: typeof defaultCloseDb
  ) => Promise<void>;
}

// Drain every booted app, then close the shared pool — the shutdown order a
// signal handler runs. stop() is optional (ADR-015 reserves it); an app without
// one (e.g. the api) is a no-op, an app with one (a queue consumer) drains its
// in-flight work before the pool closes out from under it.
export async function drainAndClose(
  apps: RunnableApp[],
  closeDb: typeof defaultCloseDb
): Promise<void> {
  for (const app of apps) {
    await app.stop?.();
  }
  await closeDb();
}

// Keep the process alive (the service handles do that) until a signal, then
// drain the apps and close the shared pool and exit. The launcher owns this, not
// index's .finally — start() resolved at ready, so closing there would kill a
// live pool mid-drain.
function waitForSignalShutdown(
  apps: RunnableApp[],
  closeDb: typeof defaultCloseDb
): Promise<void> {
  return new Promise<void>(function (resolve) {
    async function shutdown(signal: NodeJS.Signals): Promise<void> {
      logger.info('run: signal received, shutting down', { signal });
      await drainAndClose(apps, closeDb);
      resolve();
      process.exit(0);
    }
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

// Resolve the set of service names to boot: `--all` → every registered name; a
// `<name>` → that one, or throw with the valid set if it isn't registered.
function selectServices(
  input: ServicesRunInput,
  resolveService: typeof defaultResolveService,
  serviceNames: typeof defaultServiceNames
): string[] {
  if (input.all) {
    return serviceNames();
  }
  // The schema guarantees exactly one of name/--all, so name is set here.
  const name = input.name as string;
  if (!resolveService(name)) {
    throw new UnknownServiceError(
      `unknown service "${name}"; registered: ${serviceNames().join(', ')}`
    );
  }
  return [name];
}

// Boot one service: load its RunnableApp, call start(), report elapsed boot
// time. The app is returned alongside the summary row so the shutdown path can
// drain it.
async function bootService(
  name: string,
  load: () => Promise<RunnableApp>
): Promise<{
  app: RunnableApp;
  summary: { service: string; status: 'ready'; elapsedMs: number };
}> {
  logger.info('run: starting', { name });
  const startedAt = performance.now();
  const app = await load();
  await app.start();
  const elapsedMs = Math.round(performance.now() - startedAt);
  logger.info('run: ready', { name, elapsedMs });
  return { app, summary: { service: name, status: 'ready', elapsedMs } };
}

export async function runServicesRun(
  input: ServicesRunInput,
  deps: ServicesRunDeps = {}
): Promise<void> {
  const resolveService = deps.resolveService ?? defaultResolveService;
  const serviceNames = deps.serviceNames ?? defaultServiceNames;
  const closeDb = deps.closeDb ?? defaultCloseDb;
  const waitForShutdown = deps.waitForShutdown ?? waitForSignalShutdown;

  const names = selectServices(input, resolveService, serviceNames);

  // Boot all selected services on the one event loop; Promise.all settles once
  // every one is ready, and they keep running on their own handles.
  const booted = await Promise.all(
    names.map(function (name) {
      const load = resolveService(name);
      if (!load) {
        throw new UnknownServiceError(
          `unknown service "${name}"; registered: ${serviceNames().join(', ')}`
        );
      }
      return bootService(name, load);
    })
  );

  const apps = booted.map((b) => b.app);
  const summary = booted.map((b) => b.summary);

  logger.info('run: all ready', { count: summary.length });
  process.stdout.write(JSON.stringify(summary) + '\n');

  // Block until a shutdown signal; keeps the process alive and parseAsync pending
  // (so index's .finally(closeDb) doesn't fire while services run). On the signal,
  // booted apps are drained before the pool closes.
  await waitForShutdown(apps, closeDb);
}
