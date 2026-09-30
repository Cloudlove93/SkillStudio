FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV HOME=/tmp/educlaw-worker

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system media-worker \
    && useradd --system --gid media-worker --home-dir /nonexistent media-worker \
    && mkdir -p /tmp/educlaw-worker \
    && chown media-worker:media-worker /tmp/educlaw-worker

COPY python/media_worker/pyproject.toml ./pyproject.toml
COPY python/media_worker/src ./src

RUN python -m pip install --no-cache-dir '.[asr-local]'

USER media-worker

ENTRYPOINT ["educlaw-media-worker"]
