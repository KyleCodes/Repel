import { describe, expect, test } from 'bun:test';
import { renderEnvLocal } from '../env-file';

describe('renderEnvLocal', function () {
  test('writes the 5 stack vars with a trailing newline', function () {
    const body = renderEnvLocal({
      databaseUrl: 'postgres://repel:dev@localhost:16069/repel',
      pgPort: 16069,
      grafanaPort: 12069,
      apiPort: 14069,
      projectName: 'repel_rep-69',
    });
    expect(body).toBe(
      'DATABASE_URL=postgres://repel:dev@localhost:16069/repel\n' +
        'PG_PORT=16069\n' +
        'GRAFANA_PORT=12069\n' +
        'API_PORT=14069\n' +
        'COMPOSE_PROJECT_NAME=repel_rep-69\n'
    );
  });
});
