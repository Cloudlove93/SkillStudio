FROM m.daocloud.io/docker.io/library/python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV HOME=/tmp/educlaw-worker

WORKDIR /app

RUN set -eux; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    for attempt in 1 2 3; do \
      if apt-get update && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates ffmpeg; then break; fi; \
      if [ "$attempt" = 3 ]; then exit 1; fi; \
      rm -rf /var/lib/apt/lists/*; \
      sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/* \
    && groupadd --system media-worker \
    && useradd --system --gid media-worker --home-dir /nonexistent media-worker \
    && mkdir -p /tmp/educlaw-worker \
    && chown media-worker:media-worker /tmp/educlaw-worker

COPY python/media_worker/pyproject.toml ./pyproject.toml
COPY python/media_worker/src ./src

RUN python -m pip install --no-cache-dir '.[asr-local]'

USER media-worker

ENTRYPOINT ["educlaw-media-worker"]
