# cgr.dev/chainguard/python (Wolfi, current Python 3, amd64 and arm64, rebuilt daily): no shell, no package manager.
# The -dev variant has a shell and is used only to set file modes. Renovate updates both digests.
# Pass --build-arg BASE_IMAGE=... and BUILD_IMAGE=... (internal mirrors of the same digests) where cgr.dev is not reachable.
ARG BUILD_IMAGE=cgr.dev/chainguard/python:latest-dev@sha256:e63f203676982bd645ab325340ae5e847f84106392a4a3bab8575fda41340a46
ARG BASE_IMAGE=cgr.dev/chainguard/python:latest@sha256:31dd69d84fe5235fe18f8ceb5b76620e6f44a0ce1f9b0d3a46c491576f8b453b

FROM ${BUILD_IMAGE} AS files
USER 0
COPY app /out/app
# files must be readable by uid 65534 whatever umask the build host checked them out with
RUN chmod -R a=rX /out/app && mkdir /out/state

FROM ${BASE_IMAGE}
ARG APP_VERSION=dev
ARG APP_REVISION=unknown
# Recent history goes to /state unless UI_STATE_DIR is set empty. Mount a volume there to keep it when the container is replaced.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_VERSION=${APP_VERSION} APP_REVISION=${APP_REVISION} UI_STATE_DIR=/state
COPY --from=files /out/app /app
COPY --from=files --chown=65534:65534 /out/state /state
# nobody, as before: the base's own nonroot user is 65532
USER 65534:65534
LABEL org.opencontainers.image.source=https://github.com/newen-systems/registry-lite-ui \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${APP_REVISION}
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["/usr/bin/python", "-c", "import os, ssl, urllib.request as u; u.urlopen(('https' if os.environ.get('UI_TLS_CERT') else 'http') + '://127.0.0.1:8080/healthz', timeout=2, context=ssl._create_unverified_context())"]
ENTRYPOINT ["/usr/bin/python"]
CMD ["/app/server.py"]
