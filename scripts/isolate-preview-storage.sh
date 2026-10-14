#!/usr/bin/env bash
# Isolate Cloudflare Pages PREVIEW storage for project `whisk`.
# Never writes production bindings, secrets, or data.
#
# PHASE=pre-deploy   snapshot + create KV/R2 + inject wrangler.toml [env.preview]
# PHASE=post-deploy  bind preview KV/R2, set preview APP_SECRET, copy plaintext vars,
#                    assert production unchanged, verify /api/auth
# PHASE=all          pre + post (no pages deploy)
set -euo pipefail

PHASE="${PHASE:-all}"
PROJECT="${PROJECT:-whisk}"
PROD_KV_ID="${PROD_KV_ID:-9961b213d1114876af09f83f3884aeb9}"
PROD_R2_NAME="${PROD_R2_NAME:-whisk-photos}"
PREVIEW_KV_TITLE="${PREVIEW_KV_TITLE:-whisk-preview-kv}"
PREVIEW_R2_NAME="${PREVIEW_R2_NAME:-whisk-photos-preview}"
PREVIEW_URL="${PREVIEW_URL:-https://cursor-kitchn-discover-hang.whisk-15t.pages.dev}"
PROD_URL="${PROD_URL:-https://whisk-15t.pages.dev}"
STATE_DIR="${STATE_DIR:-${GITHUB_WORKSPACE:-.}/.isolate-preview}"
WRANGLER_TOML="${WRANGLER_TOML:-wrangler.toml}"

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
cf_post() { cf_request POST "$1" "$2"; }
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

get_project() {
  cf_get "/pages/projects/${PROJECT}"
}

snapshot_production() {
  local raw="$1"
  echo "$raw" | jq -c '{
    kv: .result.deployment_configs.production.kv_namespaces,
    r2: .result.deployment_configs.production.r2_buckets,
    d1: .result.deployment_configs.production.d1_databases,
    vectorize: .result.deployment_configs.production.vectorize_bindings,
    env_names: (
      .result.deployment_configs.production.env_vars // {}
      | to_entries
      | map({name: .key, type: .value.type})
      | sort_by(.name)
    )
  }'
}

print_binding_table() {
  local label="$1"
  local raw="$2"
  echo "===== ${label} =====" >&2
  echo "$raw" | jq '{
    project: .result.name,
    production: {
      kv: .result.deployment_configs.production.kv_namespaces,
      r2: .result.deployment_configs.production.r2_buckets,
      d1: .result.deployment_configs.production.d1_databases,
      vectorize: .result.deployment_configs.production.vectorize_bindings,
      env_var_names: (
        .result.deployment_configs.production.env_vars // {}
        | to_entries
        | map({name: .key, type: .value.type})
        | sort_by(.name)
      )
    },
    preview: {
      kv: .result.deployment_configs.preview.kv_namespaces,
      r2: .result.deployment_configs.preview.r2_buckets,
      d1: .result.deployment_configs.preview.d1_databases,
      vectorize: .result.deployment_configs.preview.vectorize_bindings,
      env_var_names: (
        .result.deployment_configs.preview.env_vars // {}
        | to_entries
        | map({name: .key, type: .value.type})
        | sort_by(.name)
      )
    }
  }'
}

ensure_preview_kv() {
  local page=1
  local found=""
  while true; do
    local list
    list="$(cf_get "/storage/kv/namespaces?per_page=100&page=${page}")"
    if ! echo "$list" | jq -e '.success == true' >/dev/null 2>&1; then
      echo "KV list failed (will try create). Response:" >&2
      echo "$list" | jq '{success, errors, messages}' 2>/dev/null >&2 || echo "$list" >&2
      break
    fi
    found="$(echo "$list" | jq -r --arg title "$PREVIEW_KV_TITLE" '[.result[]? | select(.title == $title) | .id][0] // empty')"
    if [[ -n "$found" ]]; then
      echo "$found"
      return 0
    fi
    local count
    count="$(echo "$list" | jq '.result | length' 2>/dev/null || echo 0)"
    if [[ "${count:-0}" -lt 100 ]]; then
      break
    fi
    page=$((page + 1))
  done

  echo "Creating KV namespace ${PREVIEW_KV_TITLE}" >&2
  local created
  created="$(cf_post "/storage/kv/namespaces" "$(jq -nc --arg title "$PREVIEW_KV_TITLE" '{title: $title}')")"
  if echo "$created" | jq -e '.success == true and .result.id' >/dev/null 2>&1; then
    echo "$created" | jq -r '.result.id'
    return 0
  fi
  echo "REST create failed; trying wrangler kv namespace create" >&2
  echo "$created" | jq '{success, errors, messages}' 2>/dev/null >&2 || echo "$created" >&2
  local wrangler_out wrangler_id
  wrangler_out="$(bunx --bun wrangler kv namespace create "$PREVIEW_KV_TITLE" 2>&1 | tee /dev/stderr || true)"
  wrangler_id="$(echo "$wrangler_out" | sed -n 's/.*id = "\([a-f0-9]\{32\}\)".*/\1/p' | head -n1)"
  if [[ -z "$wrangler_id" ]]; then
    wrangler_id="$(echo "$wrangler_out" | sed -n 's/.*"id": "\([a-f0-9]\{32\}\)".*/\1/p' | head -n1)"
  fi
  if [[ -z "$wrangler_id" ]]; then
    echo "Direct KV create failed. Trying Worker auto-provision." >&2
    wrangler_id="$(provision_via_worker_kv || true)"
  fi
  if [[ -z "$wrangler_id" ]]; then
    echo "Could not create KV namespace yet." >&2
    return 0
  fi
  echo "$wrangler_id"
}

provision_via_worker() {
  # wrangler deploy of a throwaway Worker can auto-provision KV/R2 and
  # write IDs back — Pages tokens sometimes have Workers edit, sometimes not.
  local dir
  dir="$(mktemp -d)"
  cat > "${dir}/wrangler.toml" <<EOF
name = "whisk-preview-provisioner"
main = "index.js"
compatibility_date = "2024-12-01"
account_id = "${CLOUDFLARE_ACCOUNT_ID}"

[[kv_namespaces]]
binding = "WHISK_KV"

[[r2_buckets]]
binding = "WHISK_R2"
bucket_name = "${PREVIEW_R2_NAME}"
EOF
  printf '%s\n' 'export default { fetch() { return new Response("ok"); } };' > "${dir}/index.js"
  echo "Auto-provisioning via wrangler deploy ${dir}" >&2
  if ! (cd "$dir" && bunx --bun wrangler deploy --name whisk-preview-provisioner 2>&1 | tee /tmp/provision-worker.log | sed 's/.*/provision: &/' >&2); then
    echo "Worker auto-provision deploy failed" >&2
    return 1
  fi
  local kv_id
  kv_id="$(sed -n 's/.*id = "\([a-f0-9]\{32\}\)".*/\1/p' "${dir}/wrangler.toml" | head -n1)"
  if [[ -z "$kv_id" ]]; then
    kv_id="$(sed -n 's/.*"id": "\([a-f0-9]\{32\}\)".*/\1/p' /tmp/provision-worker.log | head -n1)"
  fi
  echo "Provisioner wrangler.toml:" >&2
  grep -v -i secret "${dir}/wrangler.toml" >&2 || true
  if [[ -z "$kv_id" ]]; then
    return 1
  fi
  printf '%s' "$kv_id" > "${STATE_DIR}/provisioned-kv-id.txt"
  echo "$kv_id"
}

provision_via_worker_kv() {
  provision_via_worker
}

ensure_preview_r2() {
  local list
  echo "Listing R2 buckets" >&2
  list="$(cf_get "/r2/buckets")"
  if echo "$list" | jq -e --arg name "$PREVIEW_R2_NAME" '
      (.result.buckets // .result // [])
      | if type == "array" then .[] else empty end
      | select((.name // .) == $name)
    ' >/dev/null 2>&1; then
    echo "$PREVIEW_R2_NAME"
    return 0
  fi

  echo "Creating R2 bucket ${PREVIEW_R2_NAME}" >&2
  local created
  created="$(cf_post "/r2/buckets" "$(jq -nc --arg name "$PREVIEW_R2_NAME" '{name: $name}')")"
  if echo "$created" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "$PREVIEW_R2_NAME"
    return 0
  fi
  # Already exists is fine (race or alternate list shape).
  if echo "$created" | jq -e '.errors[]? | select(.code == 10004 or (.message | test("already exists"; "i")))' >/dev/null 2>&1; then
    echo "$PREVIEW_R2_NAME"
    return 0
  fi
  echo "REST create failed; trying wrangler r2 bucket create" >&2
  echo "$created" | jq '{success, errors, messages}' 2>/dev/null >&2 || echo "$created" >&2
  if bunx --bun wrangler r2 bucket create "$PREVIEW_R2_NAME" >&2; then
    echo "$PREVIEW_R2_NAME"
    return 0
  fi
  echo "Could not create R2 via REST/wrangler (token may be Pages-only). Will rely on wrangler pages deploy auto-provision." >&2
}

inject_wrangler_preview() {
  local kv_id="$1"
  local kv_id_line=""
  if [[ -n "$kv_id" ]]; then
    kv_id_line="id = \"${kv_id}\""
  fi
  local snippet
  snippet="$(cat <<EOF

# Preview environment — isolated KV/R2. Top-level bindings above remain production.
# Future \`wrangler pages deploy\` on a non-production branch uses these IDs.
# Production deploys keep using ${PROD_KV_ID} and ${PROD_R2_NAME}.
[[env.preview.kv_namespaces]]
binding = "WHISK_KV"
${kv_id_line}

[[env.preview.r2_buckets]]
binding = "WHISK_R2"
bucket_name = "${PREVIEW_R2_NAME}"

[env.preview.ai]
binding = "AI"

[[env.preview.vectorize]]
binding = "VECTORIZE"
index_name = "whisk-recipes"

[env.preview.vars]
ENVIRONMENT = "preview"
EOF
)"
  printf '%s\n' "$snippet" > "${STATE_DIR}/wrangler-preview-snippet.toml"

  if grep -q '\[\[env.preview.kv_namespaces\]\]' "$WRANGLER_TOML"; then
    if grep -q "id = \"${kv_id}\"" "$WRANGLER_TOML"; then
      echo "wrangler.toml already has [env.preview] for ${kv_id}"
      return 0
    fi
    echo "Updating existing [env.preview] KV id in wrangler.toml (runner copy)"
    python3 - "$WRANGLER_TOML" "$kv_id" "$PREVIEW_R2_NAME" <<'PY'
import re, sys
path, kv_id, r2 = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
text = re.sub(
    r'(?s)# Preview environment.*?ENVIRONMENT = "preview"\n',
    "",
    text,
)
text = re.sub(
    r'(?s)\[\[env\.preview\.kv_namespaces\]\].*?(?=\n\[|\Z)',
    "",
    text,
)
open(path, "w").write(text.rstrip() + "\n")
PY
  fi

  printf '%s\n' "$snippet" >> "$WRANGLER_TOML"
  echo "Injected [env.preview] into ${WRANGLER_TOML} (runner working copy unless committed)"
}

write_preview_secret_file() {
  local password="$1"
  # Never echo the password. File is uploaded as a 1-day artifact.
  {
    printf '%s\n' "$password"
    printf '%s\n' "$PREVIEW_URL"
    printf '%s\n' "preview-only, isolated KV/R2"
  } > "${STATE_DIR}/preview-secret.txt"
  chmod 600 "${STATE_DIR}/preview-secret.txt"
}

read_password() {
  head -n1 "${STATE_DIR}/preview-secret.txt"
}

ensure_password() {
  if [[ -f "${STATE_DIR}/preview-secret.txt" ]]; then
    mask "$(read_password)"
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
  write_preview_secret_file "$password"
  mask "$password"
}

discover_non_prod_kv() {
  echo "Listing Pages projects for existing non-production KV IDs" >&2
  local list
  list="$(cf_get "/pages/projects")"
  echo "Also fetching whisk-demo if present" >&2
  cf_get "/pages/projects/whisk-demo" | jq '{
    ok: .success,
    name: .result.name,
    prod_kv: .result.deployment_configs.production.kv_namespaces,
    preview_kv: .result.deployment_configs.preview.kv_namespaces,
    prod_r2: .result.deployment_configs.production.r2_buckets,
    preview_r2: .result.deployment_configs.preview.r2_buckets
  }' >&2 || true
  echo "$list" | jq '{
    ok: .success,
    errors: .errors,
    projects: [
      (.result // [])[]
      | {
          name,
          prod_kv: .deployment_configs.production.kv_namespaces,
          preview_kv: .deployment_configs.preview.kv_namespaces,
          prod_r2: .deployment_configs.production.r2_buckets,
          preview_r2: .deployment_configs.preview.r2_buckets
        }
    ]
  }' >&2 || echo "$list" >&2
  echo "$list" | jq -r --arg prod "$PROD_KV_ID" '
    [.result[]?
      | .deployment_configs
      | (.production.kv_namespaces, .preview.kv_namespaces)
      | .. | .namespace_id? // empty
    ]
    | unique
    | map(select(. != $prod and . != "212ca20cb74b475da57767af91a23564" and . != ""))
    | .[0] // empty
  '
}

phase_pre_deploy() {
  echo "=== PHASE pre-deploy: snapshot production, create preview KV/R2 ==="
  local raw
  raw="$(get_project)"
  require_success "$raw" "GET pages project ${PROJECT}"
  print_binding_table "BEFORE" "$raw"
  snapshot_production "$raw" > "${STATE_DIR}/production-snapshot.json"

  local prod_kv prod_r2
  prod_kv="$(echo "$raw" | jq -r '.result.deployment_configs.production.kv_namespaces.WHISK_KV.namespace_id // empty')"
  prod_r2="$(echo "$raw" | jq -r '.result.deployment_configs.production.r2_buckets.WHISK_R2.name // empty')"
  if [[ "$prod_kv" != "$PROD_KV_ID" || "$prod_r2" != "$PROD_R2_NAME" ]]; then
    echo "::error::Unexpected production bindings before mutation. Refusing to continue."
    echo "expected KV ${PROD_KV_ID} / R2 ${PROD_R2_NAME}"
    echo "actual   KV ${prod_kv} / R2 ${prod_r2}"
    exit 1
  fi

  echo "Ensuring preview KV namespace ${PREVIEW_KV_TITLE}" >&2
  local preview_kv
  preview_kv="$(ensure_preview_kv || true)"
  echo "Preview KV id=${preview_kv:-<none yet>}" >&2
  echo "Ensuring preview R2 bucket ${PREVIEW_R2_NAME}" >&2
  local preview_r2
  preview_r2="$(ensure_preview_r2 || true)"
  preview_r2="${preview_r2:-$PREVIEW_R2_NAME}"
  if [[ -z "$preview_kv" ]]; then
    echo "REST/wrangler create unavailable; trying Worker auto-provision for both KV and R2" >&2
    preview_kv="$(provision_via_worker || true)"
  fi
  if [[ -z "$preview_kv" ]]; then
    preview_kv="$(discover_non_prod_kv || true)"
    echo "Discovered non-prod KV: ${preview_kv:-<none>}" >&2
  fi
  echo "Preview R2 name=${preview_r2}" >&2
  if [[ -n "$preview_kv" && "$preview_kv" == "$PROD_KV_ID" ]]; then
    echo "::error::Preview KV resolved to production ID. Refusing to bind."
    exit 1
  fi

  jq -n --arg kv "$preview_kv" --arg r2 "$preview_r2" '{
    preview_kv_id: $kv,
    preview_r2_name: $r2
  }' > "${STATE_DIR}/preview-bindings.json"
  echo "Preview storage: KV ${preview_kv:-unavailable}  R2 ${preview_r2}"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "preview_kv_id=${preview_kv}" >> "$GITHUB_OUTPUT"
    echo "preview_r2_name=${preview_r2}" >> "$GITHUB_OUTPUT"
  fi

  if [[ -n "$preview_kv" ]]; then
    inject_wrangler_preview "$preview_kv"
    ensure_password
  else
    echo "::warning::No isolated preview KV id available. Not injecting [env.preview] and not setting APP_SECRET."
    echo "Deploy token can edit Pages but cannot create Workers KV or R2 (HTTP 401/403)."
  fi
}

capture_preview_bindings() {
  local raw="$1"
  local preview_kv preview_r2
  preview_kv="$(echo "$raw" | jq -r '.result.deployment_configs.preview.kv_namespaces.WHISK_KV.namespace_id // empty')"
  preview_r2="$(echo "$raw" | jq -r '.result.deployment_configs.preview.r2_buckets.WHISK_R2.name // empty')"
  if [[ -z "$preview_kv" || "$preview_kv" == "$PROD_KV_ID" ]]; then
    echo "::error::Preview KV is still production ${PROD_KV_ID} after deploy. Auto-provision did not isolate storage." >&2
    exit 1
  fi
  if [[ -z "$preview_r2" || "$preview_r2" == "$PROD_R2_NAME" ]]; then
    echo "::error::Preview R2 is still production ${PROD_R2_NAME} after deploy." >&2
    exit 1
  fi
  jq -n --arg kv "$preview_kv" --arg r2 "$preview_r2" '{
    preview_kv_id: $kv,
    preview_r2_name: $r2
  }' > "${STATE_DIR}/preview-bindings.json"
  echo "Captured preview bindings: KV ${preview_kv}  R2 ${preview_r2}" >&2
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "preview_kv_id=${preview_kv}" >> "$GITHUB_OUTPUT"
    echo "preview_r2_name=${preview_r2}" >> "$GITHUB_OUTPUT"
  fi
}

bind_preview_storage() {
  local kv_id r2_name
  kv_id="$(jq -r '.preview_kv_id // empty' "${STATE_DIR}/preview-bindings.json")"
  r2_name="$(jq -r '.preview_r2_name // empty' "${STATE_DIR}/preview-bindings.json")"
  if [[ -z "$kv_id" || "$kv_id" == "$PROD_KV_ID" ]]; then
    echo "No isolated preview KV id yet; skipping PATCH bind (expect wrangler deploy to have provisioned)."
    return 0
  fi
  echo "PATCH preview bindings only (production omitted)"
  local body
  body="$(jq -nc --arg kv "$kv_id" --arg r2 "$r2_name" '{
    deployment_configs: {
      preview: {
        kv_namespaces: { WHISK_KV: { namespace_id: $kv } },
        r2_buckets: { WHISK_R2: { name: $r2 } }
      }
    }
  }')"
  local patched
  patched="$(cf_patch "/pages/projects/${PROJECT}" "$body")"
  require_success "$patched" "PATCH preview KV/R2"
}

set_preview_env() {
  local password="$1"
  local raw
  raw="$(get_project)"
  require_success "$raw" "GET project before env PATCH"

  # Copy plaintext production config only. Never copy secret_text values.
  local env_body
  env_body="$(echo "$raw" | jq --arg secret "$password" '
    def plaintext:
      (.result.deployment_configs.production.env_vars // {})
      | to_entries
      | map(select(.value.type == "plain_text" and .key != "APP_SECRET"))
      | map({key, value: {type: "plain_text", value: (.value.value // "")}});
    {
      deployment_configs: {
        preview: {
          env_vars: (
            (plaintext | from_entries)
            + {
                ENVIRONMENT: {type: "plain_text", value: "preview"},
                APP_SECRET: {type: "secret_text", value: $secret}
              }
          )
        }
      }
    }
  ')"

  local names
  names="$(echo "$env_body" | jq -r '.deployment_configs.preview.env_vars | keys | sort | join(", ")')"
  echo "Setting preview env vars (names only): ${names}"

  local patched
  patched="$(cf_patch "/pages/projects/${PROJECT}" "$env_body")"
  require_success "$patched" "PATCH preview env_vars"
  echo "$names" > "${STATE_DIR}/preview-env-set.txt"
}

assert_production_unchanged() {
  local before after
  before="$(cat "${STATE_DIR}/production-snapshot.json")"
  local raw
  raw="$(get_project)"
  require_success "$raw" "GET project after mutation"
  print_binding_table "AFTER" "$raw"
  after="$(snapshot_production "$raw")"
  if [[ "$before" != "$after" ]]; then
    echo "::error::Production bindings or env-var names changed. Aborting."
    echo "BEFORE: $before"
    echo "AFTER:  $after"
    exit 1
  fi
  echo "Production snapshot matches pre-change record."

  local preview_kv preview_r2
  preview_kv="$(echo "$raw" | jq -r '.result.deployment_configs.preview.kv_namespaces.WHISK_KV.namespace_id // empty')"
  preview_r2="$(echo "$raw" | jq -r '.result.deployment_configs.preview.r2_buckets.WHISK_R2.name // empty')"
  if [[ "$preview_kv" == "$PROD_KV_ID" || "$preview_r2" == "$PROD_R2_NAME" ]]; then
    echo "::error::Preview is still bound to production storage."
    exit 1
  fi
  echo "Preview KV=${preview_kv} R2=${preview_r2}"
}

verify_auth() {
  local password="$1"
  echo "GET ${PREVIEW_URL}/api/auth"
  local preview_get
  preview_get="$(curl -sS "${PREVIEW_URL}/api/auth")"
  echo "preview GET: ${preview_get}"
  if ! echo "$preview_get" | jq -e '.bookExists == false' >/dev/null; then
    echo "::error::Preview GET /api/auth was not bookExists:false"
    exit 1
  fi

  echo "POST ${PREVIEW_URL}/api/auth (password masked)"
  local preview_post
  preview_post="$(curl -sS -X POST "${PREVIEW_URL}/api/auth" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg password "$password" '{password: $password}')")"
  if echo "$preview_post" | jq -e '.token | type == "string" and length > 0' >/dev/null; then
    echo "preview POST: token=yes"
  else
    echo "::error::Preview POST /api/auth did not return a token"
    echo "$preview_post" | jq '{error, bookExists}' || echo "$preview_post"
    exit 1
  fi

  echo "GET ${PROD_URL}/api/auth"
  local prod_get
  prod_get="$(curl -sS "${PROD_URL}/api/auth")"
  echo "production GET: ${prod_get}"
  if ! echo "$prod_get" | jq -e '.bookExists == true' >/dev/null; then
    echo "::error::Production GET /api/auth was not bookExists:true"
    exit 1
  fi
}

phase_post_deploy() {
  echo "=== PHASE post-deploy: bind preview, set APP_SECRET, verify ==="
  if [[ ! -f "${STATE_DIR}/production-snapshot.json" || ! -f "${STATE_DIR}/preview-bindings.json" ]]; then
    echo "State from pre-deploy missing; taking a fresh snapshot and ensuring resources exist."
    PHASE=pre-deploy phase_pre_deploy
  fi
  local raw
  raw="$(get_project)"
  require_success "$raw" "GET project after deploy"
  print_binding_table "AFTER-DEPLOY" "$raw"
  local preview_kv
  preview_kv="$(echo "$raw" | jq -r '.result.deployment_configs.preview.kv_namespaces.WHISK_KV.namespace_id // empty')"
  if [[ -z "$preview_kv" || "$preview_kv" == "$PROD_KV_ID" ]]; then
    echo "::error::Preview still shares production KV ${PROD_KV_ID}. Token cannot create a new namespace. APP_SECRET was not set."
    assert_production_unchanged
    exit 1
  fi
  capture_preview_bindings "$raw"
  ensure_password
  local password
  password="$(read_password)"
  bind_preview_storage
  set_preview_env "$password"
  assert_production_unchanged
  verify_auth "$password"
}

case "$PHASE" in
  pre-deploy) phase_pre_deploy ;;
  post-deploy) phase_post_deploy ;;
  all)
    phase_pre_deploy
    phase_post_deploy
    ;;
  *)
    echo "::error::Unknown PHASE=${PHASE}"
    exit 1
    ;;
esac
