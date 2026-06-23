// The launch contract every deployable app implements. `start()` resolves once
// the service is ready (its keep-alive handle — an HTTP listener, a poll loop —
// is installed), then keeps running. `stop()` is optional, for graceful drain.
export interface RunnableApp {
  start(): Promise<void>;
  stop?(): Promise<void>;
}
