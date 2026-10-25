.DEFAULT_GOAL := help

DOCKER ?= docker
PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
ENV_FILE ?= .env.docker
DEV_PROJECT ?= radio-calico-dev
PROD_PROJECT ?= radio-calico-prod
TEST_ARGS ?=

DEV_COMPOSE = $(DOCKER) compose -p "$(DEV_PROJECT)" -f compose.dev.yaml
PROD_COMPOSE = $(DOCKER) compose --env-file "$(ENV_FILE)" -p "$(PROD_PROJECT)" -f compose.prod.yaml

.PHONY: help env dev prod dev-down prod-down dev-logs prod-logs dev-status prod-status \
        test test-ratings test-backend test-frontend test-local test-docker check-prod-env

help:
	@printf '%s\n' \
	  'make env            Create private .env.docker from the example (keeps existing files)' \
	  'make dev            Build/start Development in the foreground (Ctrl+C to stop)' \
	  'make prod           Build/start healthy Production services in the background' \
	  'make dev-down       Stop Development and keep its database volume' \
	  'make prod-down      Stop Production and keep its database volume' \
	  'make dev-logs       Follow Development logs' \
	  'make prod-logs      Follow Nginx/backend/PostgreSQL logs' \
	  'make dev-status     Show Development container status' \
	  'make prod-status    Show Production container status' \
	  'make test           Build the Development image and run all tests inside Docker' \
	  'make test-ratings   Run rating tests inside Docker' \
	  'make test-backend   Run Python tests inside Docker' \
	  'make test-frontend  Run JavaScript tests inside Docker' \
	  'make test-local     Run tests using local Python and Node' \
	  'make test-docker    Run isolated Docker smoke tests, including real PostgreSQL' \
	  '' \
	  'Production: run make env, then set POSTGRES_PASSWORD in .env.docker.' \
	  'Overrides: ENV_FILE, PYTHON, DOCKER, DEV_PROJECT, PROD_PROJECT, TEST_ARGS.'

env:
	@if [ -e "$(ENV_FILE)" ]; then \
	  printf '%s\n' 'Environment file already exists; keeping it unchanged.'; \
	else \
	  (umask 077; cp .env.docker.example "$(ENV_FILE)") && \
	  printf '%s\n' 'Environment file created. Set POSTGRES_PASSWORD before make prod.'; \
	fi

check-prod-env:
	@test -f "$(ENV_FILE)" || { printf '%s\n' 'Missing environment file. Run make env, then set POSTGRES_PASSWORD.' >&2; exit 1; }
	@$(PROD_COMPOSE) config --quiet

dev:
	$(DEV_COMPOSE) up --build

prod: check-prod-env
	$(PROD_COMPOSE) up --build -d --wait

dev-down:
	$(DEV_COMPOSE) down

prod-down: check-prod-env
	$(PROD_COMPOSE) down

dev-logs:
	$(DEV_COMPOSE) logs -f app

prod-logs: check-prod-env
	$(PROD_COMPOSE) logs -f web app db

dev-status:
	$(DEV_COMPOSE) ps

prod-status: check-prod-env
	$(PROD_COMPOSE) ps

test:
	$(DEV_COMPOSE) run --build --rm --no-deps -T app python scripts/test.py $(TEST_ARGS)

test-ratings:
	$(MAKE) test TEST_ARGS="--ratings $(TEST_ARGS)"

test-backend:
	$(MAKE) test TEST_ARGS="--backend $(TEST_ARGS)"

test-frontend:
	$(MAKE) test TEST_ARGS="--frontend $(TEST_ARGS)"

test-local:
	"$(PYTHON)" scripts/test.py $(TEST_ARGS)

test-docker:
	"$(PYTHON)" scripts/test_docker.py
