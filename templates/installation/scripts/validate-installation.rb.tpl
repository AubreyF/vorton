# frozen_string_literal: true

require "digest"
require "json"
require "pathname"
require "yaml"

ROOT = Pathname.new(__dir__).join("../..").expand_path

def assert(condition, message)
  raise message unless condition
end

def build_image(path)
  in_build = false
  images = []
  path.each_line do |line|
    section = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if section
      in_build = section[1] == "build"
      next
    end
    next unless in_build

    image = line.match(/^\s*image\s*=\s*"([^"]+)"\s*$/)
    images << image[1] if image
  end
  assert(images.length == 1, "#{path} must contain exactly one [build] image")
  images.first
end

def quoted_toml_value(content, key, path)
  values = content.scan(/^\s*#{Regexp.escape(key)}\s*=\s*"([^"]+)"\s*$/).flatten
  assert(values.length == 1, "#{path} must contain exactly one #{key}")
  values.first
end

desired = YAML.safe_load(ROOT.join("vorton.yaml").read, aliases: false)
lock = JSON.parse(ROOT.join("vorton.lock.json").read)
memory = YAML.safe_load(ROOT.join("organization/memory.yaml").read, aliases: false)
modules = YAML.safe_load(ROOT.join("organization/modules.yaml").read, aliases: false)
authority = YAML.safe_load(
  ROOT.join("organization/policies/authority.yaml").read,
  aliases: false,
)

name = desired.dig("metadata", "name")
version = desired.dig("spec", "release", "version")
assert(name&.match?(/\A[a-z][a-z0-9-]*\z/), "Invalid installation name")
assert(desired.dig("spec", "realm") == "organizational", "Installation must use the organizational realm")
assert(version == lock.dig("release", "version"), "Desired and locked releases differ")
assert(
  lock.dig("release", "sourceCommit")&.match?(/\A[a-f0-9]{40}\z/),
  "Invalid source commit",
)
assert(lock.fetch("coreMigrationHead") == "{{CORE_MIGRATION_HEAD}}", "Unexpected migration head")

images = lock.fetch("images")
assert(images.keys.sort == {{EXPECTED_IMAGE_NAMES_RUBY}}, "Unexpected runtime image set")
images.each_value do |image|
  digest = image.fetch("digest")
  reference = image.fetch("reference")
  assert(digest.match?(/\Asha256:[a-f0-9]{64}\z/), "Invalid image digest")
  assert(reference.end_with?("@#{digest}"), "Runtime image is not digest-pinned")
end


if images.key?("web")
  deployment_images = {
    "deploy/api.fly.toml" => images.fetch("control-plane").fetch("reference"),
    "deploy/web.fly.toml" => images.fetch("web").fetch("reference"),
    "deploy/worker.fly.toml" => images.fetch("worker").fetch("reference"),
    "deploy/hindsight.fly.toml" => "ghcr.io/vectorize-io/hindsight@sha256:a0e937366261b8a8f20ebcaf13758c689c381dcbbf01684e4375c2787c8c666d",
  }
  deployment_images.each do |relative_path, expected_reference|
    path = ROOT.join(relative_path)
    assert(path.file?, "Missing deployment configuration #{relative_path}")
    content = path.read
    assert(build_image(content) == expected_reference, "Unexpected deployment image at #{relative_path}")
    assert(!content.match?(/^\s*dockerfile\s*=/), "Source build is forbidden at #{relative_path}")
    if relative_path == "deploy/hindsight.fly.toml"
      worker_id = quoted_toml_value(content, "HINDSIGHT_API_WORKER_ID", relative_path)
      expected_worker_id = "#{name}-memory"
      assert(worker_id == expected_worker_id, "Unexpected Hindsight worker ID")
      assert(worker_id.length >= 8, "Hindsight worker ID must contain at least 8 characters")
      if lock["lastUpgradeEdge"].nil?
        {
        "memory" => "2gb",
        "HINDSIGHT_ENABLE_API" => "true",
        "HINDSIGHT_ENABLE_CP" => "false",
        "HINDSIGHT_API_HOST" => "::",
        "HINDSIGHT_API_DATABASE_BACKEND" => "postgresql",
        "HINDSIGHT_API_LLM_PROVIDER" => "openai-codex",
        "HINDSIGHT_API_LLM_MODEL" => "gpt-5.4-mini",
        "HINDSIGHT_API_LLM_REASONING_EFFORT" => "low",
        "HINDSIGHT_API_LLM_MAX_CONCURRENT" => "1",
        "HINDSIGHT_API_LLM_STRICT_SCHEMA" => "true",
        "HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER" => "openai-codex",
        "HINDSIGHT_API_CONSOLIDATION_LLM_MODEL" => "gpt-5.4-mini",
        "HINDSIGHT_API_CONSOLIDATION_LLM_REASONING_EFFORT" => "low",
        "HINDSIGHT_API_CONSOLIDATION_LLM_MAX_CONCURRENT" => "1",
        "HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM" => "1",
        "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP" => "false",
        "HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH" => "true",
        "CODEX_HOME" => "/data/hindsight-codex",
        "HINDSIGHT_API_EMBEDDINGS_PROVIDER" => "local",
        "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL" => "BAAI/bge-small-en-v1.5",
        "HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU" => "true",
        "HINDSIGHT_API_RERANKER_PROVIDER" => "rrf",
        "HINDSIGHT_API_ENABLE_OBSERVATIONS" => "true",
        "HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION" => "true",
        "HINDSIGHT_API_WORKER_ENABLED" => "true",
        }.each do |key, value|
          assert(quoted_toml_value(content, key, relative_path) == value, "Unexpected #{key} at #{relative_path}")
        end
        assert(quoted_toml_value(content, "destination", relative_path) == "/data", "Unexpected Hindsight auth volume destination")
        worker_mount = ROOT.join("deploy/worker.fly.toml").read
        worker_sources = worker_mount.scan(/^\s*source\s*=\s*"([^"]+)"\s*$/).flatten
        if worker_sources.any?
          assert(worker_sources.length == 1, "deploy/worker.fly.toml must contain exactly one source")
          assert(
            quoted_toml_value(content, "source", relative_path) != worker_sources.first,
            "Hindsight and executive worker must use separate auth volumes",
          )
        end
      end
    end
  end
end

lock.fetch("managedFiles").each do |relative_path, expected_digest|
  path = ROOT.join(relative_path)
  assert(path.file?, "Missing managed file #{relative_path}")
  observed_digest = "sha256:#{Digest::SHA256.file(path).hexdigest}"
  assert(observed_digest == expected_digest, "Managed file drift at #{relative_path}")
end

assert(memory.dig("memory", "provider") == "hindsight", "Unexpected memory provider")
assert(memory.dig("memory", "authority") == "none", "Derived memory cannot grant authority")
assert(
  memory.dig("memory", "canonicalRecords") == "supabase-postgres",
  "Postgres must remain canonical",
)
assert(modules.dig("modules", "factory", "mode") == "read-only", "Factory must remain read-only")
assert(
  authority.dig("authority", "factory", "executionAuthority") == "external",
  "Factory execution authority moved into the installation",
)
assert(modules.dig("modules", "tools", "installed") == [], "Installed Tools catalog must start blank")

installed_tool_files = ROOT.join("tools").children.select(&:file?).reject { |path| path.basename.to_s == "README.md" }
assert(installed_tool_files.empty?, "Unexpected installed tool files")

puts "#{name} Vorton installation #{version} valid"
