import express, { Application, NextFunction, Request, Response } from 'express';
import { getOptionalEnvVar } from '../lib/env.ts';

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
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

export function startApi(): Promise<void> {
  return new Promise(function (resolve) {
    const app = createRouter();
    const port = getOptionalEnvVar('PORT', '3000');
    app.listen(port, function () {
      console.log(`API listening on port ${port}`);
      resolve();
    });
  });
}
