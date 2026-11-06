FROM m.daocloud.io/docker.io/library/python:3.11-slim

ARG DEBIAN_MIRRORS="mirrors.tuna.tsinghua.edu.cn mirrors.aliyun.com deb.debian.org"

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV HOME=/tmp/educlaw-worker

WORKDIR /app

RUN set -eux; \
    cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources; \
    installed=0; \
    for mirror in $DEBIAN_MIRRORS; do \
      sed "s|deb.debian.org|$mirror|g" /tmp/debian.sources > /etc/apt/sources.list.d/debian.sources; \
      if apt-get -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o Acquire::Retries=1 update \
        && apt-get -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o Acquire::Retries=1 install -y --no-install-recommends ca-certificates ffmpeg; then installed=1; break; fi; \
      apt-get clean; \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    done; \
    test "$installed" = 1; \
    rm -f /tmp/debian.sources; \
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
