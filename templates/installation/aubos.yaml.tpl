apiVersion: aubos.dev/v1alpha1
kind: Installation
metadata:
  name: {{INSTALLATION_NAME}}
spec:
  release:
    channel: pinned
    version: {{RELEASE_VERSION}}
  modules:
    - admin
    - tasks
    - tools
  deployment:
    provider: fly
    region: sea
  secrets:
    supabase-url: AUBOS_SUPABASE_URL
    supabase-anon-key: AUBOS_SUPABASE_ANON_KEY
