# cgr.dev/chainguard/python (Wolfi, current Python 3, amd64 and arm64, rebuilt daily): no shell, no package manager.
# The -dev variant has a shell and is used only to set file modes. Renovate updates both digests.
# Pass --build-arg BASE_IMAGE=... and BUILD_IMAGE=... (internal mirrors of the same digests) where cgr.dev is not reachable.
ARG BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:e63f203676982bd645ab325340ae5e847f84106392a4a3bab8575fda41340a46
ARG BASE_IMAGE=cgr.dev/chainguard/python:latest@sha256:31dd69d84fe5235fe18f8ceb5b76620e6f44a0ce1f9b0d3a46c491576f8b453b

FROM ${BUILD_IMAGE} AS files
USER 0
COPY app /out/app
# files must be readable by any uid the image drops to, whatever umask the build host checked them out with
RUN chmod -R a=rX /out/app

FROM ${BASE_IMAGE}
ARG APP_VERSION=dev
ARG APP_REVISION=unknown
# Recent history goes to UI_STATE_DIR unless it is set empty. server.py creates it at start, owned by the uid it
# drops to, so nothing is baked here. Default /state/data: mount a volume at /state (a fresh one is root-owned) and
# the UI creates /state/data under it, which it can then write whatever uid it runs as. Replace with your own path to override.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_VERSION=${APP_VERSION} APP_REVISION=${APP_REVISION} UI_STATE_DIR=/state/data
COPY --from=files /out/app /app
# Starts as root so server.py can drop to PUID:PGID (default 65534:65534, PUID=0 PGID=0 stays root), linuxserver-style.
USER 0
LABEL org.opencontainers.image.source=https://github.com/newen-systems/registry-lite-ui \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${APP_REVISION}
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["/usr/bin/python", "-c", "import os, ssl, urllib.request as u; u.urlopen(('https' if os.environ.get('UI_TLS_CERT') else 'http') + '://127.0.0.1:8080/healthz', timeout=2, context=ssl._create_unverified_context())"]
ENTRYPOINT ["/usr/bin/python"]
CMD ["/app/server.py"]
