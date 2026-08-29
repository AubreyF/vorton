# Organization-owned Fly configuration. AubOS will never overwrite this file.
app = "{{INSTALLATION_NAME}}-aubos"
primary_region = "sea"

[build]
  image = "REPLACE_WITH_LOCKED_OCI_REFERENCE"

[env]
  AUBOS_INSTALLATION = "{{INSTALLATION_NAME}}"
