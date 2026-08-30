# Organization-owned Fly configuration. Vorton upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-worker"
primary_region = "sea"

[build]
  image = "{{WORKER_IMAGE}}"

[env]
  PORT = "8080"
  VORTON_WORKER_PROVIDER = "codex-subscription"
  VORTON_CODEX_MODEL = "replace-with-explicit-codex-model"
  VORTON_CODEX_REASONING_EFFORT = "high"
  VORTON_CODEX_EXECUTION_TIMEOUT_MS = "900000"
  VORTON_CODEX_HOME = "/data/codex"
  VORTON_CODEX_WORKDIR = "/var/lib/vorton-worker"
  VORTON_CODEX_CLASSIFICATION_CEILING = "internal"

# Set VORTON_WORKER_SHARED_SECRET and the one-time VORTON_CODEX_AUTH_JSON seed
# with Fly secrets. After a healthy volume-backed restart, remove the seed with
# `fly secrets unset VORTON_CODEX_AUTH_JSON --app <worker-app>` and verify health.
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
