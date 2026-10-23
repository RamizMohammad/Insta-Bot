.PHONY: install dev worker beat test lint format typecheck check migrate revision db up down logs prod demo openapi

install:            ## Install all dependencies (incl. dev)
	uv sync

dev:                ## Run the API with auto-reload (needs DATABASE_URL / REDIS_URL)
	uv run uvicorn app.main:app --reload --port 8000

worker:             ## Run a Celery worker
	uv run celery -A app.workers.celery_app worker --loglevel=INFO -Q instaflow

beat:               ## Run the Celery scheduler (outbox relay, reaper, token refresh)
	uv run celery -A app.workers.celery_app beat --loglevel=INFO

db:                 ## Start a local PostgreSQL without Docker and print DATABASE_URL
	uv run python scripts/local_postgres.py

migrate:            ## Apply migrations
	uv run alembic upgrade head

revision:           ## Autogenerate a migration: make revision m="message"
	uv run alembic revision --autogenerate -m "$(m)"

test:               ## Run the test suite (starts a throwaway PostgreSQL if TEST_DATABASE_URL is unset)
	uv run pytest -q

lint:
	uv run ruff check .
	uv run ruff format --check .

format:
	uv run ruff format .
	uv run ruff check . --fix

typecheck:
	uv run mypy app scripts

check: lint typecheck test   ## Everything CI should run

up:                 ## Docker: build and start the full stack
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f api worker scheduler

prod:               ## Docker: production start (expects a production .env)
	docker compose up -d --build api worker scheduler

demo:               ## Run the simulation walkthrough against a running API
	uv run python scripts/simulate_demo.py

openapi:            ## Regenerate docs/openapi.json
	uv run python scripts/export_openapi.py
