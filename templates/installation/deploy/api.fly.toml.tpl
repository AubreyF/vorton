# Organization-owned Fly configuration. Vorton upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-api"
primary_region = "sea"

[build]
  image = "{{CONTROL_PLANE_IMAGE}}"

[env]
  PORT = "8080"
  VORTON_DATABASE_SSL = "true"
  VORTON_SUPABASE_PROJECT_REF = "replace-with-project-ref"
  VORTON_SUPABASE_URL = "https://replace-with-project-ref.supabase.co"
  VORTON_SUPABASE_JWT_ISSUER = "https://replace-with-project-ref.supabase.co/auth/v1"
  VORTON_SUPABASE_JWT_AUDIENCE = "authenticated"
  VORTON_SUPABASE_JWKS_URL = "https://replace-with-project-ref.supabase.co/auth/v1/.well-known/jwks.json"
  VORTON_WORKER_URL = "http://{{INSTALLATION_NAME}}-worker.internal:8080"
  VORTON_WORKER_PROVIDER = "codex-subscription"
  VORTON_WORKER_MODEL = "replace-with-explicit-codex-model"
  VORTON_WORKER_CLASSIFICATION_CEILING = "internal"
  VORTON_WORKER_REQUEST_TIMEOUT_MS = "930000"
  VORTON_ALLOWED_ORIGIN = "https://{{INSTALLATION_NAME}}-web.fly.dev"
  VORTON_HINDSIGHT_URL = "http://{{INSTALLATION_NAME}}-hindsight.internal:8888"

# Set VORTON_DATABASE_URL, VORTON_DATABASE_CONTEXT_SIGNING_SECRET,
# VORTON_WORKER_SHARED_SECRET, and VORTON_HINDSIGHT_API_KEY with Fly secrets. Set
# VORTON_DATABASE_SSL_CA_BASE64 when the authority database uses a private CA.

[http_service]
  internal_port = 8080
  force_https = true
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [http_service.http_options]
    idle_timeout = 960

  [[http_service.checks]]
    interval = "15s"
    timeout = "3s"
    grace_period = "10s"
    method = "GET"
    path = "/readyz"
