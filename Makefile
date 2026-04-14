.PHONY: dev dev-down migrate-create migrate-up migrate-down typecheck test

dev:
	docker compose --profile dev up -d

dev-down:
	docker compose --profile dev down

migrate-create:
	cd apps/server && bunx node-pg-migrate create $(name) --migrations-dir src/db/migrations --migration-file-language sql

migrate-up:
	cd apps/server && bunx node-pg-migrate up --migrations-dir src/db/migrations

migrate-down:
	cd apps/server && bunx node-pg-migrate down --migrations-dir src/db/migrations

typecheck:
	bun run typecheck

test:
	bun test
