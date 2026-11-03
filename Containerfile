# registry.access.redhat.com/ubi9/python-312-minimal:9.8 (UBI 9.8, Python 3.12), multi-arch index digest
# Pass --build-arg BASE_IMAGE=<internal mirror of the same digest> where that registry is not reachable.
ARG BASE_IMAGE=registry.access.redhat.com/ubi9/python-312-minimal@sha256:d0ac54e77cd0be473b22fb274493526027f2746ec503b4a97ca08257813f0d4b
FROM ${BASE_IMAGE}
ARG APP_VERSION=dev
ARG APP_REVISION=unknown
# Recent history goes to /state unless UI_STATE_DIR is set empty. Mount a volume there to keep it when the container is replaced.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_VERSION=${APP_VERSION} APP_REVISION=${APP_REVISION} UI_STATE_DIR=/state
COPY app /app
USER 0
# files must be readable by uid 65534 whatever umask the build host checked them out with.
# The app is stdlib only, so pip leaves the image: nothing installs packages at run time.
RUN chmod -R a=rX /app && mkdir /state && chown 65534:65534 /state \
 && rm -rf /opt/app-root/lib/python3*/site-packages/pip /opt/app-root/lib/python3*/site-packages/pip-*.dist-info /opt/app-root/bin/pip*
USER 65534:65534
LABEL org.opencontainers.image.source=https://github.com/newen-systems/registry-lite-ui \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${APP_REVISION}
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["python", "-c", "import os, ssl, urllib.request as u; u.urlopen(('https' if os.environ.get('UI_TLS_CERT') else 'http') + '://127.0.0.1:8080/healthz', timeout=2, context=ssl._create_unverified_context())"]
CMD ["python", "/app/server.py"]
