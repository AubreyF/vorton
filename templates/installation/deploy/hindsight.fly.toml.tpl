# Organization-owned Fly configuration. Hindsight remains pinned separately
# from the AubOS release manifest.
app = "{{INSTALLATION_NAME}}-hindsight"
primary_region = "sea"

[build]
  image = "{{HINDSIGHT_IMAGE}}"

[env]
  HINDSIGHT_API_HOST = "0.0.0.0"
  HINDSIGHT_API_PORT = "8888"
  HINDSIGHT_API_WORKER_ID = "{{HINDSIGHT_WORKER_ID}}"
  HINDSIGHT_API_DATABASE_BACKEND = "postgres"
  HINDSIGHT_API_LLM_PROVIDER = "replace-with-explicit-provider"
  HINDSIGHT_API_LLM_MODEL = "replace-with-explicit-model"
  HINDSIGHT_API_EMBEDDINGS_PROVIDER = "openai"
  HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL = "replace-with-explicit-embedding-model"
  HINDSIGHT_API_RERANKER_PROVIDER = "rrf"
  HINDSIGHT_API_TENANT_EXTENSION = "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension"
  HINDSIGHT_API_MCP_ENABLED = "false"
  HINDSIGHT_API_LOG_FORMAT = "json"

# Set HINDSIGHT_API_DATABASE_URL, HINDSIGHT_API_TENANT_API_KEY, and provider
# credentials with Fly secrets.

[[services]]
  internal_port = 8888
  protocol = "tcp"
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1

  [[services.tcp_checks]]
    interval = "20s"
    timeout = "5s"
    grace_period = "30s"
