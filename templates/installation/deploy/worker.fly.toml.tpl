# Organization-owned Fly configuration. AubOS upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-worker"
primary_region = "sea"

[build]
  image = "{{WORKER_IMAGE}}"

[env]
  PORT = "8080"
  AUBOS_WORKER_PROVIDER = "openai-responses"
  AUBOS_OPENAI_MODEL = "replace-with-explicit-model"
  AUBOS_OPENAI_STORE_RESPONSES = "false"
  AUBOS_OPENAI_CLASSIFICATION_CEILING = "internal"

# Set AUBOS_WORKER_SHARED_SECRET and AUBOS_OPENAI_API_KEY with Fly secrets.

[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [[services.http_checks]]
    interval = "15s"
    timeout = "3s"
    grace_period = "10s"
    method = "GET"
    path = "/healthz"
