FROM node:22-bookworm-slim AS node

FROM python:3.11-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=3000 \
    DATABASE_PATH=/data/radiocalico.sqlite

WORKDIR /app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir /data \
    && chown app:app /data

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY app.py config.py database.py diagnostics.py ratings.py ./
COPY static/ ./static/
COPY templates/ ./templates/
COPY docker/healthcheck.py /usr/local/bin/radio-calico-healthcheck.py

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "/usr/local/bin/radio-calico-healthcheck.py"]

FROM base AS development

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY tests/ ./tests/
COPY test/ ./test/
COPY scripts/test.py ./scripts/test.py
COPY package.json ./
USER 10001:10001

CMD ["python", "-m", "flask", "--app", "app:create_app()", "run", "--host=0.0.0.0", "--port=3000", "--debug", "--no-debugger"]

FROM base AS frontend-build
COPY docker/render_frontend.py ./docker/render_frontend.py
RUN python docker/render_frontend.py /tmp/frontend/index.html

FROM nginxinc/nginx-unprivileged:stable-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /tmp/frontend/index.html /usr/share/nginx/html/index.html
COPY static/ /usr/share/nginx/html/static/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/api/health"]

FROM base AS production

USER root
COPY requirements-production.txt ./
RUN python -m pip install --no-cache-dir -r requirements-production.txt
COPY gunicorn.conf.py ./
USER 10001:10001

CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:create_app()"]
