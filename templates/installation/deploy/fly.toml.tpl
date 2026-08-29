# Legacy schema-v1 deployment intent. Schema-v2 installations use the four
# service-specific Fly configurations alongside this file.
app = "{{INSTALLATION_NAME}}-aubos"
primary_region = "sea"

[build]
  image = "REPLACE_WITH_LOCKED_OCI_REFERENCE"

[env]
  AUBOS_INSTALLATION = "{{INSTALLATION_NAME}}"
