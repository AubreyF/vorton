# Organization-owned Fly configuration. AubOS upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-worker"
primary_region = "sea"

[build]
  image = "{{WORKER_IMAGE}}"

[env]
  PORT = "8080"
  AUBOS_WORKER_PROVIDER = "codex-subscription"
  AUBOS_CODEX_MODEL = "replace-with-explicit-codex-model"
  AUBOS_CODEX_REASONING_EFFORT = "high"
  AUBOS_CODEX_EXECUTION_TIMEOUT_MS = "900000"
  AUBOS_CODEX_HOME = "/data/codex"
  AUBOS_CODEX_WORKDIR = "/var/empty/aubos-worker"
  AUBOS_CODEX_CLASSIFICATION_CEILING = "internal"

# Set AUBOS_WORKER_SHARED_SECRET and the one-time AUBOS_CODEX_AUTH_JSON seed
# with Fly secrets. After a healthy volume-backed restart, remove the seed with
# `fly secrets unset AUBOS_CODEX_AUTH_JSON --app <worker-app>` and verify health.
# The persistent cache is never overwritten by the seed.

[[mounts]]
  source = "{{INSTALLATION_NAME}}_codex_auth"
  destination = "/data"

[checks.health]
  type = "http"
  port = 8080
  interval = "15s"
  timeout = "3s"
  grace_period = "10s"
  method = "get"
  path = "/healthz"
