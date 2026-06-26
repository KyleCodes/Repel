import express, { Application, NextFunction, Request, Response } from 'express';
import { getOptionalEnvVar } from '@repel/backend-env/accessors';
import { runWithLogContext } from '@repel/logger/context';
import { logger } from '@repel/logger/logger';

// Augment Express Request with the org id resolved by middleware.
// Route handlers call decorated service singletons directly (e.g.
// `messageService.list({ orgId: req.orgId })`); transactions are owned
// inside the service decorators, not here. See ADR-010 (rewritten 2026-04-18).
declare global {
  namespace Express {
    interface Request {
      orgId: string;
    }
  }
}

export function createRouter(): Application {
  const app = express();

  // Establish the per-request diagnostic context first, so every downstream
  // handler and the error handler log under service:'api' with a shared
  // traceId. Express invokes next() synchronously, so ALS spans the chain.
  app.use(function (_req, _res, next) {
    runWithLogContext({ service: 'api', traceId: crypto.randomUUID() }, next);
  });

  app.use(express.json());

  app.get('/health', function (_req, res) {
    res.json({ ok: true });
  });

  // Org context middleware — all /api routes require X-Org-Id.
  // This only validates + attaches the id; route handlers pass it into
  // the service-singleton call which opens the runInOrgTx transaction.
  app.use('/api', function (req: Request, res: Response, next: NextFunction) {
    const orgId = req.headers['x-org-id'];
    if (!orgId || typeof orgId !== 'string') {
      res.status(401).json({ error: 'X-Org-Id header required' });
      return;
    }
    req.orgId = orgId;
    next();
  });

  app.use(function (
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) {
    logger.error('request failed', err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

export function startApi(): Promise<void> {
  return new Promise(function (resolve) {
    const app = createRouter();
    const port = getOptionalEnvVar('PORT', '3000');
    app.listen(port, function () {
      logger.info('listening', { port });
      resolve();
    });
  });
}
