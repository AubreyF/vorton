#!/bin/sh
set -eu

web_root="${AUBOS_WEB_ROOT:-/usr/share/nginx/html}"
nginx_template="${AUBOS_NGINX_TEMPLATE:-/etc/nginx/aubos.conf.template}"
nginx_output="${AUBOS_NGINX_OUTPUT:-/etc/nginx/conf.d/default.conf}"

fail() {
  printf '%s\n' "AubOS web startup refused: $1" >&2
  exit 1
}

require_value() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"
  [ -n "$variable_value" ] || fail "$variable_name is required"
}

validate_https_origin() {
  variable_name="$1"
  eval "variable_value=\${$variable_name}"
  printf '%s' "$variable_value" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$' || \
    fail "$variable_name must be an HTTPS origin without credentials, a path, query, or hash"
  case "$variable_value" in
    *..*|*.-*|*-.*) fail "$variable_name contains an invalid hostname" ;;
  esac
}

validate_public_supabase_key() {
  key="$AUBOS_PUBLIC_SUPABASE_ANON_KEY"
  case "$key" in
    sb_secret_*) fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY must never contain a Supabase secret key" ;;
    sb_publishable_[A-Za-z0-9_-]*)
      printf '%s' "$key" | grep -Eq '^sb_publishable_[A-Za-z0-9_-]+$' || \
        fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY has an invalid publishable-key format"
      ;;
    eyJ[A-Za-z0-9._-]*)
      printf '%s' "$key" | grep -Eq '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' || \
        fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY has an invalid legacy JWT format"
      payload="$(printf '%s' "$key" | cut -d. -f2 | tr '_-' '/+')"
      case $((${#payload} % 4)) in
        0) ;;
        2) payload="${payload}==" ;;
        3) payload="${payload}=" ;;
        *) fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY has an invalid legacy JWT payload" ;;
      esac
      decoded_payload="$(printf '%s' "$payload" | base64 -d 2>/dev/null)" || \
        fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY has an unreadable legacy JWT payload"
      printf '%s' "$decoded_payload" | grep -Eq '"role"[[:space:]]*:[[:space:]]*"anon"' || \
        fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY legacy JWT must have the anon role"
      ;;
    *) fail "AUBOS_PUBLIC_SUPABASE_ANON_KEY must be a Supabase publishable key or legacy anon JWT" ;;
  esac
}

require_value AUBOS_PUBLIC_SUPABASE_URL
require_value AUBOS_PUBLIC_SUPABASE_ANON_KEY
require_value AUBOS_PUBLIC_API_URL
validate_https_origin AUBOS_PUBLIC_SUPABASE_URL
validate_https_origin AUBOS_PUBLIC_API_URL
validate_public_supabase_key

supabase_url="${AUBOS_PUBLIC_SUPABASE_URL%/}"
api_url="${AUBOS_PUBLIC_API_URL%/}"

mkdir -p "$web_root" "$(dirname "$nginx_output")"
umask 022
runtime_tmp="${web_root}/.runtime-config.js.$$"
nginx_tmp="${nginx_output}.tmp.$$"
trap 'rm -f "$runtime_tmp" "$nginx_tmp"' EXIT HUP INT TERM

{
  printf '%s\n' 'globalThis.__AUBOS_RUNTIME_CONFIG__ = Object.freeze({'
  printf '  supabaseUrl: "%s",\n' "$supabase_url"
  printf '  supabaseAnonKey: "%s",\n' "$AUBOS_PUBLIC_SUPABASE_ANON_KEY"
  printf '  apiUrl: "%s"\n' "$api_url"
  printf '%s\n' '});'
} > "$runtime_tmp"
mv "$runtime_tmp" "$web_root/runtime-config.js"

sed \
  -e "s|@@AUBOS_SUPABASE_ORIGIN@@|$supabase_url|g" \
  -e "s|@@AUBOS_API_ORIGIN@@|$api_url|g" \
  "$nginx_template" > "$nginx_tmp"
mv "$nginx_tmp" "$nginx_output"

trap - EXIT HUP INT TERM
