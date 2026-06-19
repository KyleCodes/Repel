// Reserved per manifesto §9. The queue — Postgres-backed today (planned),
// swappable for SQS/RabbitMQ/Kafka/Inngest/Temporal later. Nothing outside
// this directory and processing-pipeline/runner.ts should know which
// implementation is in use. Implementation lands alongside the first real
// handler. Until then this directory is shape-only.
export {};
