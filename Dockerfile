# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# One image, two roles.
#
# `SERVICE_ROLE=api|worker|both` picks what the process does at runtime, so
# `docker compose up` locally and Railway in production run the *same artifact*.
# That is the whole point: the plan lists macOS-dev-versus-Linux-deploy drift as
# a named risk, and a parity loop only works if there is one thing to be at
# parity with.
#
# Built on Playwright's own image, at the tag matching the pinned library
# version. Browser and library must move together or captures drift between a
# developer's laptop and the deployed scanner — and a scanner whose results
# depend on where it ran is not evidence of anything.
# ─────────────────────────────────────────────────────────────────────────────
ARG PLAYWRIGHT_VERSION=1.61.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS base

# The base image ships whatever Node was current when it was cut — 24 at the
# time of writing — while CI and `.node-version` pin 22.23.1. Running a
# different major in production than the one the tests ran on is exactly the
# drift this image exists to prevent, so the version is read from the pin file
# rather than written here: the two cannot disagree.
COPY .node-version /tmp/.node-version
RUN set -eux; \
    NODE_VERSION="$(tr -d '[:space:]' < /tmp/.node-version)"; \
    case "$(dpkg --print-architecture)" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"; \
    cd /tmp; \
    # `.tar.gz`, not `.tar.xz`: the Playwright image has no `xz-utils`, and
    # apt-getting one to unpack a tarball is a package more than this needs.
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}" -o "${TARBALL}"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o SHASUMS256.txt; \
    # Verified, because this downloads a binary and then runs everything we
    # ship inside it. HTTPS says who served the file, not what is in it.
    grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xzf "${TARBALL}" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "/tmp/${TARBALL}" /tmp/SHASUMS256.txt /tmp/.node-version; \
    corepack enable; \
    node --version

WORKDIR /app
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # The browsers are already in the base image. Without this, Playwright looks
    # in a home-relative cache that does not exist and reports "install
    # chromium" from inside a container that has five of them.
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # Downloading them again would double the image for no reason.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies. Manifests first, so a source-only change does not re-resolve
# the whole workspace.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/schemas/package.json   packages/schemas/
COPY packages/tokens/package.json    packages/tokens/
COPY packages/wcag/package.json      packages/wcag/
COPY packages/model/package.json     packages/model/
COPY packages/engine/package.json    packages/engine/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY apps/cli/package.json           apps/cli/
COPY apps/server/package.json        apps/server/
COPY apps/web/package.json           apps/web/
COPY fixtures/apps/seeded-demo/package.json fixtures/apps/seeded-demo/

# The full install, dev dependencies included, because ADR-0002 runs the server
# under `tsx` through Phase 2 — and because the workspace packages export
# `./src/index.ts`, so there is no compiled entry point for Node to load anyway.
# `--ignore-scripts` keeps the image from running install hooks; the two the
# workspace allows (esbuild, lefthook) place binaries we either do not need here
# or get from the base image.
#
# No BuildKit cache mount here on purpose. Railway's builder requires a
# platform-specific prefix on a cache id and rejects the Dockerfile without
# one — and a Dockerfile that only builds on one platform is not the portable
# artifact this file is meant to be. Layer caching already covers the common
# case: the manifests are copied on their own above, so a source-only change
# does not re-resolve anything.
RUN pnpm install --frozen-lockfile --prefer-offline

# ─────────────────────────────────────────────────────────────────────────────
# Build the SPA. The server serves it, so the public URL is the app rather than
# a bare API.
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @handrail/web build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM build AS runtime

# Playwright's image ships this user and its browser permissions. Chromium is
# the one thing here that renders arbitrary attacker-supplied content, and it
# does not do that as root.
USER pwuser

ENV NODE_ENV=production \
    SERVICE_ROLE=both \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# Liveness only. Readiness — Postgres, the queue and a real Chromium launch — is
# `/readyz`, and it is the platform's job to poll it, because a container that
# restarts itself over a database blip comes back to the same database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are *not* run here. They are an explicit pre-start step — Railway's
# `preDeployCommand`, compose's `migrate` service — because two containers
# starting together must not race each other through the same DDL.
CMD ["pnpm", "--filter", "@handrail/server", "start"]
