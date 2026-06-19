// Worker entrypoint. Runs the queue consumers (sync, process, …) once they
// exist; per-queue tuning is a parameter, not a separate entrypoint.
async function main(): Promise<void> {
  console.log('Worker not yet implemented');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
