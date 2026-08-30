# Organization-owned Fly configuration. Vorton upgrades replace only the
# digest-pinned image field in this file.
app = "{{INSTALLATION_NAME}}-web"
primary_region = "sea"

[build]
  image = "{{WEB_IMAGE}}"

[env]
  VORTON_PUBLIC_INSTALLATION_SLUG = "{{INSTALLATION_NAME}}"
  VORTON_PUBLIC_INSTALLATION_NAME = {{DISPLAY_NAME_JSON}}
  VORTON_PUBLIC_SUPABASE_URL = "https://replace-with-project-ref.supabase.co"
  VORTON_PUBLIC_SUPABASE_ANON_KEY = "replace-with-public-anon-key"
  VORTON_PUBLIC_API_URL = "https://{{INSTALLATION_NAME}}-api.fly.dev"

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
