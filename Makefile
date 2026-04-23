.PHONY: dev dev-down migrate-create migrate-up migrate-down typecheck test

dev:
	docker compose --profile dev up -d

dev-down:
	docker compose --profile dev down

# node-pg-migrate runs through Bun (not Node) so .ts migrations can import
# from @repel/shared without a build step. `bun --bun x` keeps the Bun runtime
# inside the bunx-resolved binary; without --bun, node-pg-migrate would fall
# back to Node's ESM loader and fail to resolve .js-style imports of .ts files.
migrate-create:
	cd apps/server && bun --bun x node-pg-migrate create $(name) --migrations-dir src/db/migrations --migration-file-language ts

migrate-up:
	cd apps/server && bun --bun x node-pg-migrate up --migrations-dir src/db/migrations

migrate-down:
	cd apps/server && bun --bun x node-pg-migrate down --migrations-dir src/db/migrations

typecheck:
	bun run typecheck

test:
	bun test
