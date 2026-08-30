# Organization-owned Fly configuration. Hindsight remains pinned separately
# from the Vorton release manifest.
app = "{{INSTALLATION_NAME}}-hindsight"
primary_region = "sea"

[build]
  image = "{{HINDSIGHT_IMAGE}}"

[vm]
  memory = "2gb"

[env]
  HINDSIGHT_ENABLE_API = "true"
  HINDSIGHT_ENABLE_CP = "false"
  HINDSIGHT_API_HOST = "::"
  HINDSIGHT_API_PORT = "8888"
  HINDSIGHT_API_WORKER_ID = "{{HINDSIGHT_WORKER_ID}}"
  HINDSIGHT_API_DATABASE_BACKEND = "postgresql"
  HINDSIGHT_API_LLM_PROVIDER = "openai-codex"
  HINDSIGHT_API_LLM_MODEL = "gpt-5.4-mini"
  HINDSIGHT_API_LLM_REASONING_EFFORT = "low"
  HINDSIGHT_API_LLM_MAX_CONCURRENT = "1"
  HINDSIGHT_API_LLM_STRICT_SCHEMA = "true"
  HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER = "openai-codex"
  HINDSIGHT_API_CONSOLIDATION_LLM_MODEL = "gpt-5.4-mini"
  HINDSIGHT_API_CONSOLIDATION_LLM_REASONING_EFFORT = "low"
  HINDSIGHT_API_CONSOLIDATION_LLM_MAX_CONCURRENT = "1"
  HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM = "1"
  HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP = "false"
  HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH = "true"
  CODEX_HOME = "/data/hindsight-codex"
  HINDSIGHT_API_EMBEDDINGS_PROVIDER = "local"
  HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL = "BAAI/bge-small-en-v1.5"
  HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU = "true"
  HINDSIGHT_API_RERANKER_PROVIDER = "rrf"
  HINDSIGHT_API_ENABLE_OBSERVATIONS = "true"
  HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION = "true"
  HINDSIGHT_API_WORKER_ENABLED = "true"
  HINDSIGHT_API_TENANT_EXTENSION = "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension"
  HINDSIGHT_API_MCP_ENABLED = "false"
  HINDSIGHT_API_LOG_FORMAT = "json"

# Set HINDSIGHT_API_DATABASE_URL and HINDSIGHT_API_TENANT_API_KEY with Fly
# secrets. Seed /data/hindsight-codex/auth.json once with a dedicated Codex
# login. Never copy the executive worker's rotating auth cache into this volume.

[[mounts]]
  source = "{{INSTALLATION_NAME}}_hindsight_codex_auth"
  destination = "/data"

[checks.ready]
  type = "http"
  port = 8888
  interval = "20s"
  timeout = "5s"
  grace_period = "30s"
  method = "get"
  path = "/health/ready"

[checks.live]
  type = "http"
  port = 8888
  interval = "20s"
  timeout = "5s"
  grace_period = "30s"
  method = "get"
  path = "/health/live"
