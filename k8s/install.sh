#!/bin/bash
#
# Sunbird-RC Kubernetes Installation Script
#
# This script:
# 1. Deploys all Sunbird-RC services
# 2. Initializes Vault (first time only)
# 3. Saves Vault keys to local file
# 4. Unseals Vault automatically
# 5. Configures identity service with Vault token
# 6. Sets up auto-unseal CronJob for automatic recovery
#
# Usage:
#   ./install.sh              # Full installation
#   ./install.sh --unseal     # Only unseal Vault (after restart)
#   ./install.sh --status     # Check status of all services
#

set -e

# Configuration
NAMESPACE="sunbird-rc-namespace"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_FILE="${SCRIPT_DIR}/vault-keys.json"
CREDENTIALS_FILE="${SCRIPT_DIR}/credentials.json"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config}"
# External base URL for browser access (e.g. http://sunbird.example.com)
# If set, Keycloak frontend URL and registry OAUTH2 issuer will use this.
EXTERNAL_URL="${EXTERNAL_URL:-}"

export KUBECONFIG

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Generate random string
generate_random_string() {
    local length=${1:-32}
    tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c "$length"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl first."
        exit 1
    fi

    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Check your KUBECONFIG."
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        log_warn "jq not found. Installing..."
        sudo apt-get update && sudo apt-get install -y jq || {
            log_error "Failed to install jq. Please install it manually."
            exit 1
        }
    fi

    log_info "Prerequisites OK"
}

# Setup all credentials (MinIO and Keycloak)
setup_credentials() {
    log_info "Setting up credentials..."

    # Check if credentials file exists (for re-runs)
    if [ -f "$CREDENTIALS_FILE" ]; then
        MINIO_ACCESS_KEY=$(jq -r '.minio.access_key' "$CREDENTIALS_FILE")
        MINIO_SECRET_KEY=$(jq -r '.minio.secret_key' "$CREDENTIALS_FILE")
        KEYCLOAK_ADMIN_CLIENT_SECRET=$(jq -r '.keycloak.admin_client_secret' "$CREDENTIALS_FILE")
        log_info "Using existing credentials from $CREDENTIALS_FILE"
    else
        # Generate new random credentials
        MINIO_ACCESS_KEY=$(generate_random_string 20)
        MINIO_SECRET_KEY=$(generate_random_string 40)
        KEYCLOAK_ADMIN_CLIENT_SECRET=$(generate_random_string 32)

        # Save credentials to file
        cat > "$CREDENTIALS_FILE" << EOF
{
  "minio": {
    "access_key": "$MINIO_ACCESS_KEY",
    "secret_key": "$MINIO_SECRET_KEY"
  },
  "keycloak": {
    "admin_client_secret": "$KEYCLOAK_ADMIN_CLIENT_SECRET"
  }
}
EOF
        chmod 600 "$CREDENTIALS_FILE"
        log_info "Generated new credentials and saved to $CREDENTIALS_FILE"
    fi

    # Patch the unified sunbird-rc secret with generated credentials
    kubectl get secret sunbird-rc -n $NAMESPACE > /dev/null 2>&1 && {
        kubectl patch secret sunbird-rc -n $NAMESPACE --type=merge -p \
            "{\"stringData\":{\"minio-access-key\":\"$MINIO_ACCESS_KEY\",\"minio-secret-key\":\"$MINIO_SECRET_KEY\",\"keycloak-admin-client-secret\":\"$KEYCLOAK_ADMIN_CLIENT_SECRET\"}}"
    } || {
        log_warn "sunbird-rc secret not found yet, credentials will be applied after configmap.yaml"
    }

    log_info "Credentials updated in sunbird-rc secret"
}

# Build and push custom registry image with schemas baked in
build_registry_image() {
    log_info "Building custom registry image with schemas..."

    REPO_ROOT="${SCRIPT_DIR}/.."
    DOCKERFILE="${REPO_ROOT}/Dockerfile.registry"
    REGISTRY_HOST="${LOCAL_REGISTRY:-192.168.21.231:5000}"
    REGISTRY_IMAGE="${REGISTRY_HOST}/sunbird-rc-registry"
    IMAGE_TAG="v$(date +%Y%m%d%H%M%S)"
    REGISTRY_IMAGE_FULL="${REGISTRY_IMAGE}:${IMAGE_TAG}"

    if [ ! -f "$DOCKERFILE" ]; then
        log_warn "Dockerfile.registry not found at $DOCKERFILE — using base image without schemas"
        return 0
    fi

    # Build
    log_info "Building image: ${REGISTRY_IMAGE_FULL}"
    docker build -t "${REGISTRY_IMAGE_FULL}" -f "$DOCKERFILE" "$REPO_ROOT" || {
        log_error "Docker build failed"
        return 1
    }

    # Push
    log_info "Pushing image to local registry..."
    docker push "${REGISTRY_IMAGE_FULL}" || {
        log_error "Docker push failed — ensure local registry is running and insecure-registries is configured"
        return 1
    }

    # Update the registry deployment image
    log_info "Updating registry deployment to use ${REGISTRY_IMAGE_FULL}"
    kubectl set image deployment/registry registry="${REGISTRY_IMAGE_FULL}" -n $NAMESPACE

    log_info "Custom registry image deployed: ${REGISTRY_IMAGE_FULL}"
}

# Helper: run curl command via a temporary pod in the cluster
# Creates a pod, waits for completion, gets clean logs, then cleans up.
# This avoids the issue of kubectl's "pod deleted" message contaminating output.
kube_curl() {
    local name="curl-$(head -c 4 /dev/urandom | xxd -p)"
    # Create pod (non-interactive, --command overrides ENTRYPOINT)
    kubectl run "$name" --restart=Never --image=curlimages/curl -n $NAMESPACE \
        --command -- "$@" > /dev/null 2>&1
    # Wait for pod to complete
    kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$name" -n $NAMESPACE \
        --timeout=60s > /dev/null 2>&1 || true
    # Get clean output from pod logs
    kubectl logs "$name" -n $NAMESPACE 2>/dev/null
    # Cleanup pod
    kubectl delete pod "$name" -n $NAMESPACE --wait=false > /dev/null 2>&1 || true
}

# Deploy all services
deploy_services() {
    log_info "Deploying Sunbird-RC services..."

    # Apply base manifests
    kubectl apply -f "${SCRIPT_DIR}/base/namespace.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/configmap.yaml"

    # Setup credentials before deploying services
    setup_credentials

    # Deploy infrastructure services first
    log_info "Deploying infrastructure services..."
    kubectl apply -f "${SCRIPT_DIR}/base/postgres.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/redis.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/kafka.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/elasticsearch.yaml"

    # Wait for database
    log_info "Waiting for database to be ready..."
    kubectl wait --for=condition=ready pod -l app=db -n $NAMESPACE --timeout=120s || true

    # Deploy Vault
    log_info "Deploying Vault..."
    kubectl apply -f "${SCRIPT_DIR}/base/vault-production.yaml"

    # Create Keycloak realm ConfigMap from realm-export.json
    log_info "Creating Keycloak realm ConfigMap..."
    kubectl create configmap keycloak-realm-config \
        --from-file=realm-export.json="${SCRIPT_DIR}/../imports/realm-export.json" \
        -n $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

    # Deploy Keycloak
    log_info "Deploying Keycloak..."
    kubectl apply -f "${SCRIPT_DIR}/base/keycloak.yaml"

    # Deploy DID services (will be restarted after vault init)
    log_info "Deploying DID services..."
    kubectl apply -f "${SCRIPT_DIR}/base/did-services.yaml"

    # Deploy remaining services
    log_info "Deploying remaining services..."
    kubectl apply -f "${SCRIPT_DIR}/base/registry.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/supporting-services.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/nginx.yaml"

    # Deploy additional services
    log_info "Deploying additional services..."
    kubectl apply -f "${SCRIPT_DIR}/base/claim-ms.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/encryption-service.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/id-gen-service.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/notification-ms.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/metrics.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/admin-portal.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/bulk-issuance.yaml"
    kubectl apply -f "${SCRIPT_DIR}/base/digilocker.yaml"

    log_info "All manifests applied"
}

# Wait for Vault pod to be running
wait_for_vault() {
    log_info "Waiting for Vault pod to be running..."

    for i in {1..60}; do
        POD_STATUS=$(kubectl get pods -n $NAMESPACE -l app=vault -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "")
        if [ "$POD_STATUS" == "Running" ]; then
            log_info "Vault pod is running"
            sleep 5  # Give it a moment to fully start
            return 0
        fi
        echo -n "."
        sleep 2
    done

    log_error "Timeout waiting for Vault pod"
    return 1
}

# Check if Vault is initialized
is_vault_initialized() {
    INIT_STATUS=$(kubectl exec -n $NAMESPACE deploy/vault -- vault status -format=json 2>/dev/null | jq -r '.initialized' || echo "false")
    [ "$INIT_STATUS" == "true" ]
}

# Check if Vault is sealed
is_vault_sealed() {
    SEAL_STATUS=$(kubectl exec -n $NAMESPACE deploy/vault -- vault status -format=json 2>/dev/null | jq -r '.sealed' || echo "true")
    [ "$SEAL_STATUS" == "true" ]
}

# Initialize Vault
init_vault() {
    log_info "Initializing Vault..."

    if is_vault_initialized; then
        log_info "Vault is already initialized"
        return 0
    fi

    # Initialize with 5 key shares, 3 threshold
    INIT_OUTPUT=$(kubectl exec -n $NAMESPACE deploy/vault -- vault operator init -key-shares=5 -key-threshold=3 -format=json)

    if [ -z "$INIT_OUTPUT" ]; then
        log_error "Failed to initialize Vault"
        return 1
    fi

    # Save keys to file
    echo "$INIT_OUTPUT" > "$KEYS_FILE"
    chmod 600 "$KEYS_FILE"

    log_info "Vault initialized successfully!"
    log_warn "Keys saved to: $KEYS_FILE"
    log_warn "IMPORTANT: Backup this file securely and delete after storing keys safely!"

    # Display keys
    echo ""
    echo "=========================================="
    echo "        VAULT KEYS - SAVE SECURELY       "
    echo "=========================================="
    echo ""
    echo "Root Token: $(echo "$INIT_OUTPUT" | jq -r '.root_token')"
    echo ""
    echo "Unseal Keys (need 3 of 5):"
    for i in {0..4}; do
        echo "  Key $((i+1)): $(echo "$INIT_OUTPUT" | jq -r ".unseal_keys_b64[$i]")"
    done
    echo ""
    echo "=========================================="
    echo ""
}

# Unseal Vault
unseal_vault() {
    log_info "Checking Vault seal status..."

    if ! is_vault_sealed; then
        log_info "Vault is already unsealed"
        return 0
    fi

    if [ ! -f "$KEYS_FILE" ]; then
        log_error "Keys file not found: $KEYS_FILE"
        log_error "Please provide unseal keys manually or restore the keys file"
        return 1
    fi

    log_info "Unsealing Vault..."

    # Get unseal keys from file
    KEY1=$(jq -r '.unseal_keys_b64[0]' "$KEYS_FILE")
    KEY2=$(jq -r '.unseal_keys_b64[1]' "$KEYS_FILE")
    KEY3=$(jq -r '.unseal_keys_b64[2]' "$KEYS_FILE")

    kubectl exec -n $NAMESPACE deploy/vault -- vault operator unseal "$KEY1" > /dev/null
    kubectl exec -n $NAMESPACE deploy/vault -- vault operator unseal "$KEY2" > /dev/null
    kubectl exec -n $NAMESPACE deploy/vault -- vault operator unseal "$KEY3" > /dev/null

    if is_vault_sealed; then
        log_error "Failed to unseal Vault"
        return 1
    fi

    log_info "Vault unsealed successfully!"
}

# Enable KV secrets engine
enable_kv_secrets() {
    log_info "Enabling KV secrets engine..."

    ROOT_TOKEN=$(jq -r '.root_token' "$KEYS_FILE")

    # Check if already enabled
    SECRETS_LIST=$(kubectl exec -n $NAMESPACE deploy/vault -- sh -c "VAULT_TOKEN=$ROOT_TOKEN vault secrets list -format=json" 2>/dev/null || echo "{}")

    if echo "$SECRETS_LIST" | jq -e '.["secret/"]' > /dev/null 2>&1; then
        log_info "KV secrets engine already enabled"
        return 0
    fi

    kubectl exec -n $NAMESPACE deploy/vault -- sh -c "VAULT_TOKEN=$ROOT_TOKEN vault secrets enable -path=secret kv" || {
        log_warn "KV secrets engine may already be enabled"
    }

    log_info "KV secrets engine enabled"
}

# Create Vault token secret for identity service
create_vault_token_secret() {
    log_info "Creating Vault token secret..."

    ROOT_TOKEN=$(jq -r '.root_token' "$KEYS_FILE")

    kubectl create secret generic vault-token \
        --from-literal=token="$ROOT_TOKEN" \
        -n $NAMESPACE \
        --dry-run=client -o yaml | kubectl apply -f -

    log_info "Vault token secret created"
}

# Setup Keycloak - update admin-api client secret
# The realm, clients, roles, and role assignments are all imported from realm-export.json
# via the KEYCLOAK_IMPORT env var. We only need to update the client secret to match
# our credentials.json (the realm-export has a masked "**********" secret).
setup_keycloak() {
    log_info "Setting up Keycloak..."

    KEYCLOAK_ADMIN_CLIENT_SECRET=$(jq -r '.keycloak.admin_client_secret' "$CREDENTIALS_FILE")

    # Wait for Keycloak to be ready (realm import happens during startup)
    log_info "Waiting for Keycloak to be ready..."
    for i in {1..60}; do
        KC_STATUS=$(kube_curl curl -s -o /dev/null -w "%{http_code}" http://keycloak:8080/auth/ | tr -d '[:space:]' || echo "000")
        if [ "$KC_STATUS" == "200" ] || [ "$KC_STATUS" == "303" ]; then
            log_info "Keycloak is ready"
            break
        fi
        if [ "$i" == "60" ]; then
            log_error "Keycloak did not become ready within 5 minutes"
            return 0
        fi
        echo -n "."
        sleep 5
    done

    # Extra wait for realm import to complete after Keycloak responds
    log_info "Waiting for realm import to complete..."
    sleep 15

    # Get admin token
    log_info "Getting Keycloak admin token..."
    ADMIN_TOKEN=$(kube_curl curl -s -X POST \
        "http://keycloak:8080/auth/realms/master/protocol/openid-connect/token" \
        -d "username=admin&password=admin&grant_type=password&client_id=admin-cli" | jq -r '.access_token')

    if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" == "null" ]; then
        log_error "Could not get Keycloak admin token. Check Keycloak logs."
        return 0
    fi

    # Update admin-api client secret to match credentials.json
    # The realm-export.json creates admin-api but with a masked secret
    log_info "Updating admin-api client secret..."
    ADMIN_API_UUID=$(kube_curl curl -s \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "http://keycloak:8080/auth/admin/realms/sunbird-rc/clients?clientId=admin-api" | jq -r '.[0].id // empty')

    if [ -n "$ADMIN_API_UUID" ]; then
        kube_curl curl -s -X PUT \
            "http://keycloak:8080/auth/admin/realms/sunbird-rc/clients/$ADMIN_API_UUID" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"id\":\"$ADMIN_API_UUID\",\"clientId\":\"admin-api\",\"enabled\":true,\"publicClient\":false,\"secret\":\"$KEYCLOAK_ADMIN_CLIENT_SECRET\",\"serviceAccountsEnabled\":true,\"directAccessGrantsEnabled\":true}" > /dev/null
        log_info "admin-api client secret updated to match credentials.json"
    else
        log_error "admin-api client not found in realm 'sunbird-rc'"
        log_error "Realm import may have failed. Check: kubectl logs -n $NAMESPACE deploy/keycloak"
        return 0
    fi

    # Disable SSL requirement on realm (TLS is terminated at ingress)
    log_info "Setting sslRequired=none on sunbird-rc realm..."
    kube_curl curl -s -X PUT \
        "http://keycloak:8080/auth/admin/realms/sunbird-rc" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"sslRequired": "none"}' > /dev/null
    log_info "Realm SSL requirement disabled"

    log_info "Keycloak setup complete"

    # Restart registry to pick up Keycloak realm
    log_info "Restarting registry to connect to Keycloak..."
    kubectl rollout restart deployment/registry -n $NAMESPACE
}

# Setup MinIO bucket
setup_minio() {
    log_info "Setting up MinIO bucket..."

    # Wait for MinIO to be ready
    for i in {1..30}; do
        MINIO_STATUS=$(kubectl exec -n $NAMESPACE deploy/file-storage -- curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/minio/health/live 2>/dev/null || echo "000")
        if [ "$MINIO_STATUS" == "200" ]; then
            log_info "MinIO is ready"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Get credentials
    MINIO_ACCESS=$(jq -r '.minio.access_key' "$CREDENTIALS_FILE")
    MINIO_SECRET=$(jq -r '.minio.secret_key' "$CREDENTIALS_FILE")

    # Create bucket
    kubectl exec -n $NAMESPACE deploy/file-storage -- sh -c "
        mc alias set local http://localhost:9000 '$MINIO_ACCESS' '$MINIO_SECRET' 2>/dev/null && \
        mc mb --ignore-existing local/sunbird-rc 2>/dev/null && \
        mc anonymous set download local/sunbird-rc 2>/dev/null
    " || log_warn "MinIO bucket setup may have failed - check manually"

    log_info "MinIO bucket setup complete"
}

# Setup Kafka topics
setup_kafka() {
    log_info "Setting up Kafka topics..."

    # Wait for Kafka to be ready
    for i in {1..30}; do
        if kubectl exec -n $NAMESPACE deploy/kafka -- kafka-broker-api-versions --bootstrap-server localhost:9092 &> /dev/null; then
            log_info "Kafka is ready"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Create events topic
    kubectl exec -n $NAMESPACE deploy/kafka -- kafka-topics \
        --create --if-not-exists \
        --topic events \
        --bootstrap-server localhost:9092 \
        --partitions 1 --replication-factor 1 2>/dev/null || true

    # Create entity topics used by registry
    for topic in create_entity; do
        kubectl exec -n $NAMESPACE deploy/kafka -- kafka-topics \
            --create --if-not-exists \
            --topic "$topic" \
            --bootstrap-server localhost:9092 \
            --partitions 1 --replication-factor 1 2>/dev/null || true
    done

    log_info "Kafka topics created"

    # Restart metrics to pick up topics
    if kubectl get deployment metrics -n $NAMESPACE &> /dev/null; then
        kubectl rollout restart deployment/metrics -n $NAMESPACE
    fi
}

# Restart DID services to pick up new token
restart_did_services() {
    log_info "Restarting DID services..."

    kubectl rollout restart deployment/identity -n $NAMESPACE
    kubectl rollout restart deployment/credential -n $NAMESPACE
    kubectl rollout restart deployment/credential-schema -n $NAMESPACE

    log_info "DID services restarted"
}

# Setup auto-unseal CronJob
setup_auto_unseal() {
    log_info "Setting up auto-unseal CronJob..."

    if [ ! -f "$KEYS_FILE" ]; then
        log_error "Keys file not found: $KEYS_FILE"
        log_error "Cannot setup auto-unseal without keys"
        return 1
    fi

    # Get unseal keys from file
    KEY1=$(jq -r '.unseal_keys_b64[0]' "$KEYS_FILE")
    KEY2=$(jq -r '.unseal_keys_b64[1]' "$KEYS_FILE")
    KEY3=$(jq -r '.unseal_keys_b64[2]' "$KEYS_FILE")

    # Create the vault-unseal-keys secret
    kubectl create secret generic vault-unseal-keys \
        --from-literal="key1=$KEY1" \
        --from-literal="key2=$KEY2" \
        --from-literal="key3=$KEY3" \
        -n $NAMESPACE \
        --dry-run=client -o yaml | kubectl apply -f -

    # Apply the auto-unseal CronJob
    kubectl apply -f "${SCRIPT_DIR}/base/vault-auto-unseal.yaml"

    log_info "Auto-unseal CronJob configured"
    log_info "Vault will be automatically unsealed if it restarts"
}

# Configure external URL for Keycloak and registry
# This sets KEYCLOAK_FRONTEND_URL and OAUTH2_RESOURCES_0_URI so that
# tokens issued by Keycloak match the issuer expected by registry.
configure_external_url() {
    if [ -z "$EXTERNAL_URL" ]; then
        log_info "No EXTERNAL_URL set — skipping external URL configuration"
        return 0
    fi

    log_info "Configuring external URL: $EXTERNAL_URL"

    # Set Keycloak frontend URL
    kubectl set env deployment/keycloak \
        KEYCLOAK_FRONTEND_URL="${EXTERNAL_URL}/auth" \
        -n $NAMESPACE

    # Set registry OAUTH2 issuer to match Keycloak frontend URL
    kubectl set env deployment/registry \
        OAUTH2_RESOURCES_0_URI="${EXTERNAL_URL}/auth/realms/sunbird-rc" \
        -n $NAMESPACE

    log_info "External URL configured for Keycloak and registry"
}

# Wait for all services to be ready
wait_for_services() {
    log_info "Waiting for all services to be ready..."

    DEPLOYMENTS=(
        "db"
        "redis"
        "zookeeper"
        "kafka"
        "es"
        "vault"
        "keycloak"
        "identity"
        "credential-schema"
        "credential"
        "registry"
        "nginx"
        "public-key-service"
        "context-proxy-service"
        "file-storage"
        "claim-ms"
        "encryption-service"
        "id-gen-service"
        "notification-ms"
        "clickhouse"
        "metrics"
        "admin-portal"
        "bulk-issuance"
        "digilocker-certificate-api"
    )

    for deploy in "${DEPLOYMENTS[@]}"; do
        echo -n "  Waiting for $deploy..."
        kubectl wait --for=condition=available deployment/$deploy -n $NAMESPACE --timeout=180s 2>/dev/null && echo " Ready" || echo " (timeout or not found)"
    done

    log_info "Service readiness check complete"
}

# Show status
show_status() {
    echo ""
    echo "=========================================="
    echo "        SUNBIRD-RC SERVICE STATUS        "
    echo "=========================================="
    echo ""

    kubectl get pods -n $NAMESPACE

    echo ""
    echo "Vault Status:"
    kubectl exec -n $NAMESPACE deploy/vault -- vault status 2>/dev/null || echo "  Cannot connect to Vault"

    echo ""
    echo "Access URLs:"
    INGRESS_IP=$(kubectl get ingress -n $NAMESPACE -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "localhost")
    echo "  UI:      http://${INGRESS_IP}/"
    echo "  Swagger: http://${INGRESS_IP}/registry/swagger-ui.html"
    echo "  Keycloak: http://${INGRESS_IP}/auth/"
    echo ""
}

# Test services
test_services() {
    log_info "Testing services..."

    echo ""
    echo "1. Registry Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://registry:8081/health | jq -r '.result.healthy' 2>/dev/null || echo "  Failed"

    echo ""
    echo "2. Identity Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://identity:3332/health | jq -r '.status' 2>/dev/null || echo "  Failed"

    echo ""
    echo "3. Vault Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://vault:8200/v1/sys/health | jq -r '.initialized' 2>/dev/null || echo "  Failed"

    echo ""
    echo "4. DID Generation Test:"
    RESULT=$(kubectl exec -n $NAMESPACE deploy/nginx -- curl -s -X POST http://identity:3332/did/generate \
        -H "Content-Type: application/json" \
        -d '{"content":[{"alsoKnownAs":["install-test"],"method":"web"}]}' 2>/dev/null)

    if echo "$RESULT" | jq -e '.[0].id' > /dev/null 2>&1; then
        echo "  DID Generated: $(echo "$RESULT" | jq -r '.[0].id' | head -c 60)..."
    else
        echo "  Failed"
    fi

    echo ""
    echo "5. Claim-MS Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://claim-ms:8082/health 2>/dev/null || echo "  Failed"

    echo ""
    echo "6. Encryption Service Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://encryption-service:8013/health 2>/dev/null || echo "  Failed"

    echo ""
    echo "7. ID Gen Service Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://id-gen-service:8088/egov-idgen/health 2>/dev/null || echo "  Failed"

    echo ""
    echo "8. Notification Service Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s http://notification-ms:8765/notification-service/v1/health 2>/dev/null || echo "  Failed"

    echo ""
    echo "9. Admin Portal Health:"
    kubectl exec -n $NAMESPACE deploy/nginx -- curl -s -o /dev/null -w "HTTP %{http_code}" http://admin-portal:3001/ 2>/dev/null || echo "  Failed"

    echo ""
}

# Main installation flow
install() {
    echo ""
    echo "=========================================="
    echo "    SUNBIRD-RC KUBERNETES INSTALLATION   "
    echo "=========================================="
    echo ""

    check_prerequisites
    deploy_services
    wait_for_vault
    init_vault
    unseal_vault
    enable_kv_secrets
    create_vault_token_secret
    setup_auto_unseal
    configure_external_url
    setup_keycloak
    setup_minio
    setup_kafka
    build_registry_image
    restart_did_services

    log_info "Waiting for services to stabilize..."
    sleep 30

    wait_for_services
    test_services
    show_status

    echo ""
    log_info "Installation complete!"
    echo ""
    log_info "Auto-unseal CronJob is active - Vault will automatically unseal after restarts"
    echo ""
    log_warn "Remember to:"
    echo "  1. Backup $KEYS_FILE securely"
    echo "  2. Backup $CREDENTIALS_FILE securely"
    echo "  3. Store unseal keys in separate secure locations"
    echo ""
}

# Parse arguments
case "${1:-}" in
    --unseal)
        check_prerequisites
        wait_for_vault
        unseal_vault
        ;;
    --status)
        show_status
        ;;
    --test)
        test_services
        ;;
    --help)
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  (none)      Full installation"
        echo "  --unseal    Unseal Vault (after restart)"
        echo "  --status    Show status of all services"
        echo "  --test      Test all services"
        echo "  --help      Show this help"
        ;;
    *)
        install
        ;;
esac
