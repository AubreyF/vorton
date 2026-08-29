# frozen_string_literal: true

require "digest"
require "json"
require "pathname"
require "yaml"

ROOT = Pathname.new(__dir__).join("../..").expand_path

def assert(condition, message)
  raise message unless condition
end

desired = YAML.safe_load(ROOT.join("aubos.yaml").read, aliases: false)
lock = JSON.parse(ROOT.join("aubos.lock.json").read)
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
assert(
  lock.fetch("coreMigrationHead").match?(/\A[a-z0-9_]+\z/),
  "Invalid core migration head",
)

images = lock.fetch("images")
assert(images.keys.sort == ["control-plane", "worker"], "Unexpected runtime image set")
images.each_value do |image|
  digest = image.fetch("digest")
  reference = image.fetch("reference")
  assert(digest.match?(/\Asha256:[a-f0-9]{64}\z/), "Invalid image digest")
  assert(reference.end_with?("@#{digest}"), "Runtime image is not digest-pinned")
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

puts "#{name} AubOS installation #{version} valid"
