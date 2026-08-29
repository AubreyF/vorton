# Organization-owned Fly configuration. AubOS upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-web"
primary_region = "sea"

[build]
  image = "{{WEB_IMAGE}}"

[env]
  AUBOS_PUBLIC_SUPABASE_URL = "https://replace-with-project-ref.supabase.co"
  AUBOS_PUBLIC_SUPABASE_ANON_KEY = "replace-with-public-anon-key"
  AUBOS_PUBLIC_API_URL = "https://{{INSTALLATION_NAME}}-api.fly.dev"

[http_service]
  internal_port = 8080
  force_https = true
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [[http_service.checks]]
    interval = "15s"
    timeout = "3s"
    grace_period = "5s"
    method = "GET"
    path = "/healthz"
