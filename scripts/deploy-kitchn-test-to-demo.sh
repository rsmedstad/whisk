#!/usr/bin/env bash
# Deploy this PR to whisk-demo PREVIEW only (branch kitchn-test).
# Never writes whisk production bindings/secrets, and never deploys whisk-demo main.
#
# PHASE=check      snapshot whisk + whisk-demo; STOP if any whisk-prod storage is bound
# PHASE=prepare    copy wrangler-demo.toml onto runner wrangler.toml + [env.preview]
# PHASE=put-secret set preview-only APP_SECRET + OWNER_PASSWORD (+ DEMO_MODE)
# PHASE=verify     assert production untouched; token + recipe save with throwaway
set -euo pipefail

PHASE="${PHASE:-check}"
WHISK_PROJECT="${WHISK_PROJECT:-whisk}"
DEMO_PROJECT="${DEMO_PROJECT:-whisk-demo}"
WHISK_PROD_KV="${WHISK_PROD_KV:-9961b213d1114876af09f83f3884aeb9}"
WHISK_PROD_R2="${WHISK_PROD_R2:-whisk-photos}"
DEMO_KV="${DEMO_KV:-212ca20cb74b475da57767af91a23564}"
DEMO_R2="${DEMO_R2:-whisk-demo-photos-2}"
DEMO_BRANCH="${DEMO_BRANCH:-kitchn-test}"
STATE_DIR="${STATE_DIR:-${GITHUB_WORKSPACE:-.}/.demo-preview}"
WRANGLER_TOML="${WRANGLER_TOML:-wrangler.toml}"
DEMO_PROD_URL="${DEMO_PROD_URL:-https://whisk-demo.pages.dev}"
WHISK_PROD_URL="${WHISK_PROD_URL:-https://whisk-15t.pages.dev}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required"
  exit 1
fi

mkdir -p "$STATE_DIR"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")

mask() {
  local value="$1"
  if [[ -n "${GITHUB_ACTIONS:-}" && -n "$value" ]]; then
    echo "::add-mask::${value}"
  fi
}

cf_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local tmp code
  tmp="$(mktemp)"
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${AUTH[@]}" --data "$body" "${API}${path}")" || true
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "${AUTH[@]}" "${API}${path}")" || true
  fi
  echo "CF ${method} ${path} -> HTTP ${code} ($(wc -c < "$tmp") bytes)" >&2
  if [[ ! "$code" =~ ^2 ]]; then
    echo "CF error body:" >&2
    head -c 2000 "$tmp" >&2
    echo >&2
  fi
  cat "$tmp"
  rm -f "$tmp"
}

cf_get() { cf_request GET "$1"; }
cf_patch() { cf_request PATCH "$1" "$2"; }

require_success() {
  local raw="$1"
  local ctx="$2"
  if ! echo "$raw" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "::error::Cloudflare API failed: ${ctx}" >&2
    echo "$raw" | jq '{success, errors, messages}' 2>/dev/null >&2 || echo "$raw" >&2
    exit 1
  fi
}

dump_project() {
  local raw="$1"
  echo "$raw" | jq '{
    project: .result.name,
    production_deployment_id: (.result.canonical_deployment.id // .result.canonical_deployment // null),
    production: {
      kv: .result.deployment_configs.production.kv_namespaces,
      r2: .result.deployment_configs.production.r2_buckets,
      d1: .result.deployment_configs.production.d1_databases,
      env_var_names: (
        .result.deployment_configs.production.env_vars // {}
        | to_entries | map({name: .key, type: .value.type}) | sort_by(.name)
      )
    },
    preview: {
      kv: .result.deployment_configs.preview.kv_namespaces,
      r2: .result.deployment_configs.preview.r2_buckets,
      d1: .result.deployment_configs.preview.d1_databases,
      env_var_names: (
        .result.deployment_configs.preview.env_vars // {}
        | to_entries | map({name: .key, type: .value.type}) | sort_by(.name)
      )
    }
  }'
}

canonical_id() {
  echo "$1" | jq -r '.result.canonical_deployment.id // empty'
}

bindings_json() {
  echo "$1" | jq -c '{
    prod_kv: .result.deployment_configs.production.kv_namespaces,
    preview_kv: .result.deployment_configs.preview.kv_namespaces,
    prod_r2: .result.deployment_configs.production.r2_buckets,
    preview_r2: .result.deployment_configs.preview.r2_buckets,
    env_names: (
      .result.deployment_configs.production.env_vars // {}
      | to_entries | map({name: .key, type: .value.type}) | sort_by(.name)
    )
  }'
}

contains_whisk_prod() {
  echo "$1" | jq -e --arg kv "$WHISK_PROD_KV" --arg r2 "$WHISK_PROD_R2" '
    [
      .result.deployment_configs.production.kv_namespaces,
      .result.deployment_configs.preview.kv_namespaces,
      .result.deployment_configs.production.r2_buckets,
      .result.deployment_configs.preview.r2_buckets
    ]
    | .. | strings | select(. == $kv or . == $r2)
  ' >/dev/null 2>&1
}

write_secret_file() {
  local password="$1"
  local url="$2"
  {
    printf '%s\n' "$url"
    printf '%s\n' "$password"
    printf '%s\n' "whisk-demo preview, demo KV, throwaway"
  } > "${STATE_DIR}/preview-secret.txt"
  chmod 600 "${STATE_DIR}/preview-secret.txt"
}

phase_check() {
  echo "=== CHECK whisk-demo bindings (stop if any whisk-prod storage) ==="
  local demo whisk
  demo="$(cf_get "/pages/projects/${DEMO_PROJECT}")"
  require_success "$demo" "GET ${DEMO_PROJECT}"
  echo "===== whisk-demo BEFORE ====="
  dump_project "$demo"

  if contains_whisk_prod "$demo"; then
    echo "::error::STOP: whisk-demo is bound to whisk production KV ${WHISK_PROD_KV} or R2 ${WHISK_PROD_R2}."
    exit 1
  fi

  local demo_prod_kv
  demo_prod_kv="$(echo "$demo" | jq -r '.result.deployment_configs.production.kv_namespaces.WHISK_KV.namespace_id // empty')"
  if [[ "$demo_prod_kv" != "$DEMO_KV" ]]; then
    echo "::error::STOP: whisk-demo production KV is ${demo_prod_kv}, expected ${DEMO_KV}."
    exit 1
  fi

  whisk="$(cf_get "/pages/projects/${WHISK_PROJECT}")"
  require_success "$whisk" "GET ${WHISK_PROJECT}"
  echo "===== whisk production BEFORE ====="
  dump_project "$whisk"

  echo "$demo" > "${STATE_DIR}/demo-before.json"
  echo "$whisk" > "${STATE_DIR}/whisk-before.json"
  bindings_json "$whisk" > "${STATE_DIR}/whisk-prod-snapshot.json"
  canonical_id "$demo" > "${STATE_DIR}/demo-canonical-id.txt"
  echo "whisk-demo production deployment id: $(cat "${STATE_DIR}/demo-canonical-id.txt")"
  echo "Check passed: no whisk-prod storage on whisk-demo."
}

phase_prepare() {
  if [[ ! -f wrangler-demo.toml ]]; then
    echo "::error::wrangler-demo.toml missing"
    exit 1
  fi
  cp wrangler-demo.toml "$WRANGLER_TOML"
  cat >> "$WRANGLER_TOML" <<EOF

# Runner-only preview override — not committed. Forces kitchn-test onto demo KV/R2.
# Do not put APP_SECRET / OWNER_PASSWORD here: they are preview secret_text
# bindings. Wrangler rejects the same name as a var ("already in use").
[[env.preview.kv_namespaces]]
binding = "WHISK_KV"
id = "${DEMO_KV}"

[[env.preview.r2_buckets]]
binding = "WHISK_R2"
bucket_name = "${DEMO_R2}"

[env.preview.vars]
ENVIRONMENT = "preview"
DEMO_MODE = "true"
EOF
  echo "Prepared runner wrangler.toml from wrangler-demo.toml + [env.preview] (demo KV/R2)."
  grep -n 'kv_namespaces\|bucket_name\|env.preview\|ENVIRONMENT\|DEMO_MODE' "$WRANGLER_TOML" || true
}

ensure_password() {
  if [[ -f "${STATE_DIR}/preview-secret.txt" ]]; then
    mask "$(sed -n '2p' "${STATE_DIR}/preview-secret.txt")"
    return 0
  fi
  local password="${PREVIEW_APP_SECRET:-}"
  if [[ -z "$password" ]]; then
    password="$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 28)"
  fi
  if [[ ${#password} -lt 20 ]]; then
    echo "::error::Preview APP_SECRET must be at least 20 characters"
    exit 1
  fi
  mask "$password"
  write_secret_file "$password" "${PREVIEW_URL:-pending}"
}

phase_put_secret() {
  echo "=== PATCH whisk-demo PREVIEW APP_SECRET (before/after deploy) ==="
  ensure_password
  local password
  password="$(sed -n '2p' "${STATE_DIR}/preview-secret.txt")"
  local preview_url="${PREVIEW_URL:-}"
  if [[ -z "$preview_url" && -f "${STATE_DIR}/deploy-url.txt" ]]; then
    preview_url="$(cat "${STATE_DIR}/deploy-url.txt")"
  fi
  if [[ -n "$preview_url" ]]; then
    write_secret_file "$password" "$preview_url"
  fi
  echo "PATCH ${DEMO_PROJECT} preview env only (production omitted)"
  local body patched
  body="$(jq -nc --arg secret "$password" '{
    deployment_configs: {
      preview: {
        env_vars: {
          APP_SECRET: {type: "secret_text", value: $secret},
          OWNER_PASSWORD: {type: "secret_text", value: $secret},
          ENVIRONMENT: {type: "plain_text", value: "preview"},
          DEMO_MODE: {type: "plain_text", value: "true"}
        }
      }
    }
  }')"
  patched="$(cf_patch "/pages/projects/${DEMO_PROJECT}" "$body")"
  require_success "$patched" "PATCH ${DEMO_PROJECT} preview APP_SECRET"
  echo "Set on whisk-demo preview: APP_SECRET (secret), OWNER_PASSWORD (secret, same throwaway), ENVIRONMENT=preview, DEMO_MODE=true"
  echo "Did not copy production secrets. Did not write whisk-demo production env."
}

phase_verify() {
  echo "=== Verify whisk-demo preview auth and production untouched ==="
  if [[ ! -f "${STATE_DIR}/whisk-prod-snapshot.json" ]]; then
    phase_check
  fi
  ensure_password
  local password
  password="$(sed -n '2p' "${STATE_DIR}/preview-secret.txt")"

  local preview_url="${PREVIEW_URL:-}"
  if [[ -z "$preview_url" && -f "${STATE_DIR}/deploy-url.txt" ]]; then
    preview_url="$(cat "${STATE_DIR}/deploy-url.txt")"
  fi
  if [[ -z "$preview_url" ]]; then
    preview_url="https://${DEMO_BRANCH}.${DEMO_PROJECT}.pages.dev"
  fi
  write_secret_file "$password" "$preview_url"

  local demo whisk
  demo="$(cf_get "/pages/projects/${DEMO_PROJECT}")"
  require_success "$demo" "GET ${DEMO_PROJECT} after PATCH"
  echo "===== whisk-demo AFTER ====="
  dump_project "$demo"

  if contains_whisk_prod "$demo"; then
    echo "::error::STOP: whisk-demo picked up whisk production storage after deploy."
    exit 1
  fi

  local preview_kv
  preview_kv="$(echo "$demo" | jq -r '.result.deployment_configs.preview.kv_namespaces.WHISK_KV.namespace_id // empty')"
  if [[ -n "$preview_kv" && "$preview_kv" != "$DEMO_KV" ]]; then
    echo "::error::whisk-demo preview KV is ${preview_kv}, expected ${DEMO_KV}."
    exit 1
  fi

  local after_canonical
  after_canonical="$(canonical_id "$demo")"
  local before_canonical
  before_canonical="$(cat "${STATE_DIR}/demo-canonical-id.txt")"
  echo "whisk-demo production deployment id before=${before_canonical} after=${after_canonical}"
  if [[ "$after_canonical" != "$before_canonical" ]]; then
    echo "::error::whisk-demo production deployment ID changed."
    exit 1
  fi

  whisk="$(cf_get "/pages/projects/${WHISK_PROJECT}")"
  require_success "$whisk" "GET ${WHISK_PROJECT} after deploy"
  echo "===== whisk production AFTER ====="
  dump_project "$whisk"
  local before_whisk after_whisk
  before_whisk="$(cat "${STATE_DIR}/whisk-prod-snapshot.json")"
  after_whisk="$(bindings_json "$whisk")"
  if [[ "$before_whisk" != "$after_whisk" ]]; then
    echo "::error::whisk production bindings or env-var names changed."
    echo "BEFORE: $before_whisk"
    echo "AFTER:  $after_whisk"
    exit 1
  fi
  echo "whisk production snapshot unchanged."

  local caps auth payload attempt
  caps=""
  for attempt in 1 2 3 4 5 6 7 8 9; do
    echo "GET ${preview_url}/api/capabilities (attempt ${attempt})"
    caps="$(curl -sS --max-time 20 "${preview_url}/api/capabilities" || true)"
    if echo "$caps" | jq -e '.demoMode | type == "boolean"' >/dev/null 2>&1; then
      break
    fi
    echo "preview not ready yet ($(echo "$caps" | head -c 80))"
    sleep 8
  done
  echo "capabilities: ${caps}"
  echo "$caps" > "${STATE_DIR}/capabilities.json"
  if ! echo "$caps" | jq -e '.demoMode | type == "boolean"' >/dev/null 2>&1; then
    echo "::error::Preview never returned JSON capabilities at ${preview_url}"
    exit 1
  fi
  local demo_mode
  demo_mode="$(echo "$caps" | jq -r '.demoMode')"
  echo "DEMO_MODE runtime: ${demo_mode}"

  echo "POST ${preview_url}/api/auth (password masked)"
  payload="$(jq -nc --arg password "$password" --arg name KitchnPreview '{password: $password, name: $name}')"
  auth=""
  for attempt in 1 2 3 4 5 6; do
    auth="$(curl -sS --max-time 20 -X POST "${preview_url}/api/auth" \
      -H "Content-Type: application/json" \
      --data-binary "$payload" || true)"
    if echo "$auth" | jq -e '.token | type == "string" and length > 0' >/dev/null 2>&1; then
      break
    fi
    echo "auth not ready ($(echo "$auth" | jq -c '{error, demoMode}' 2>/dev/null || echo "$auth" | head -c 80))"
    sleep 8
  done
  if ! echo "$auth" | jq -e '.token | type == "string" and length > 0' >/dev/null; then
    echo "::error::POST /api/auth did not return a token"
    echo "$auth" | jq '{error, demoMode}' || echo "$auth"
    exit 1
  fi
  echo "$auth" | jq '{userId, name, isOwner, demoMode, isDemoOwner, hasToken: (.token != null)}'
  echo "$auth" | jq '{userId, name, isOwner, demoMode, isDemoOwner, hasToken: (.token != null)}' \
    > "${STATE_DIR}/auth-summary.json"

  local token is_demo_owner
  token="$(echo "$auth" | jq -r '.token')"
  is_demo_owner="$(echo "$auth" | jq -r '.isDemoOwner')"
  if [[ "$demo_mode" == "true" && "$is_demo_owner" != "true" ]]; then
    echo "::error::DEMO_MODE is on but throwaway login is not demo owner — recipe writes would be guest-locked."
    exit 1
  fi

  echo "POST ${preview_url}/api/recipes (probe, then delete)"
  local created recipe_id
  created="$(curl -sS --max-time 30 -X POST "${preview_url}/api/recipes" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    --data-binary '{"title":"Kitchn preview probe","ingredients":[{"name":"salt"}],"steps":[{"text":"probe"}]}')"
  if echo "$created" | jq -e '.id | type == "string" and length > 0' >/dev/null 2>&1; then
    recipe_id="$(echo "$created" | jq -r '.id')"
    echo "recipe save ok id=${recipe_id}"
    curl -sS --max-time 20 -o /dev/null -w "DELETE /api/recipes/${recipe_id} -> %{http_code}\n" \
      -X DELETE "${preview_url}/api/recipes/${recipe_id}" \
      -H "Authorization: Bearer ${token}" || true
  else
    echo "::error::Throwaway login could not save a recipe"
    echo "$created" | jq '{error, demoRestricted}' || echo "$created"
    exit 1
  fi

  echo "GET ${WHISK_PROD_URL}/api/auth"
  echo "whisk prod: $(curl -sS "${WHISK_PROD_URL}/api/auth")"
  echo "GET ${DEMO_PROD_URL}/api/auth"
  echo "demo prod: $(curl -sS "${DEMO_PROD_URL}/api/auth")"
}

case "$PHASE" in
  check) phase_check ;;
  prepare) phase_prepare ;;
  put-secret) phase_put_secret ;;
  verify) phase_verify ;;
  *)
    echo "::error::Unknown PHASE=${PHASE}"
    exit 1
    ;;
esac
