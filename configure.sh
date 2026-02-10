#!/bin/bash
#
# configure.sh - Post-deployment configuration for Sunbird RC on Akvo GCP test cluster
#
# This script handles tasks that can't be done declaratively via k8s manifests:
# 1. Create keycloak-realm-config ConfigMap (realm-export.json is 71KB)
# 2. Initialize and unseal the Sunbird RC application Vault
# 3. Enable KV secrets engine and create vault-token secret
# 4. Update Keycloak admin-api client secret to match Vault secret
# 5. Setup MinIO bucket
# 6. (Optional) Build and push custom registry image with schemas
#
# Usage:
#   ./configure.sh                  # Full configuration
#   ./configure.sh --vault-init     # Only init/unseal Vault
#   ./configure.sh --keycloak       # Only setup Keycloak
#   ./configure.sh --minio          # Only setup MinIO bucket
#   ./configure.sh --build-image    # Only build and push registry image
#   ./configure.sh --status         # Check status of all services
#

set -e

# Configuration
NAMESPACE="sunbird-rc-namespace"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_FILE="${SCRIPT_DIR}/configure-vault-keys.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Helper: run curl command via a temporary pod in the cluster
kube_curl() {
    local name="curl-$(head -c 4 /dev/urandom | xxd -p)"
    kubectl run "$name" --restart=Never --image=curlimages/curl -n $NAMESPACE \
        --command -- "$@" > /dev/null 2>&1
    kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$name" -n $NAMESPACE \
        --timeout=60s > /dev/null 2>&1 || true
    kubectl logs "$name" -n $NAMESPACE 2>/dev/null
    kubectl delete pod "$name" -n $NAMESPACE --wait=false > /dev/null 2>&1 || true
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found"
        exit 1
    fi

    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Please install it."
        exit 1
    fi

    # Verify namespace exists
    if ! kubectl get namespace $NAMESPACE &> /dev/null; then
        log_error "Namespace $NAMESPACE not found. Apply k8s manifests first."
        exit 1
    fi

    log_info "Prerequisites OK"
}

# Create Keycloak realm ConfigMap from realm-export.json
create_keycloak_realm_configmap() {
    log_info "Creating Keycloak realm ConfigMap..."

    REALM_FILE="${SCRIPT_DIR}/imports/realm-export.json"
    if [ ! -f "$REALM_FILE" ]; then
        log_error "realm-export.json not found at $REALM_FILE"
        return 1
    fi

    kubectl create configmap keycloak-realm-config \
        --from-file=realm-export.json="$REALM_FILE" \
        -n $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

    log_info "Keycloak realm ConfigMap created"

    # Restart Keycloak to pick up the realm if it's already running
    if kubectl get deployment keycloak -n $NAMESPACE &> /dev/null; then
        log_info "Restarting Keycloak to import realm..."
        kubectl rollout restart deployment/keycloak -n $NAMESPACE
    fi
}

# Wait for Vault pod to be running
wait_for_vault() {
    log_info "Waiting for Vault to be running..."
    for i in {1..60}; do
        POD_STATUS=$(kubectl get pods -n $NAMESPACE -l app=vault -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "")
        if [ "$POD_STATUS" == "Running" ]; then
            log_info "Vault pod is running"
            sleep 5
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
    INIT_STATUS=$(kubectl exec -n $NAMESPACE statefulset/vault -- vault status -format=json 2>/dev/null | jq -r '.initialized' || echo "false")
    [ "$INIT_STATUS" == "true" ]
}

# Check if Vault is sealed
is_vault_sealed() {
    SEAL_STATUS=$(kubectl exec -n $NAMESPACE statefulset/vault -- vault status -format=json 2>/dev/null | jq -r '.sealed' || echo "true")
    [ "$SEAL_STATUS" == "true" ]
}

# Initialize Vault
init_vault() {
    log_info "Initializing Vault..."

    if is_vault_initialized; then
        log_info "Vault is already initialized"
        return 0
    fi

    INIT_OUTPUT=$(kubectl exec -n $NAMESPACE statefulset/vault -- vault operator init -key-shares=5 -key-threshold=3 -format=json)

    if [ -z "$INIT_OUTPUT" ]; then
        log_error "Failed to initialize Vault"
        return 1
    fi

    echo "$INIT_OUTPUT" > "$KEYS_FILE"
    chmod 600 "$KEYS_FILE"

    log_info "Vault initialized! Keys saved to: $KEYS_FILE"

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
        return 1
    fi

    log_info "Unsealing Vault..."

    KEY1=$(jq -r '.unseal_keys_b64[0]' "$KEYS_FILE")
    KEY2=$(jq -r '.unseal_keys_b64[1]' "$KEYS_FILE")
    KEY3=$(jq -r '.unseal_keys_b64[2]' "$KEYS_FILE")

    kubectl exec -n $NAMESPACE statefulset/vault -- vault operator unseal "$KEY1" > /dev/null
    kubectl exec -n $NAMESPACE statefulset/vault -- vault operator unseal "$KEY2" > /dev/null
    kubectl exec -n $NAMESPACE statefulset/vault -- vault operator unseal "$KEY3" > /dev/null

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

    SECRETS_LIST=$(kubectl exec -n $NAMESPACE statefulset/vault -- sh -c "VAULT_TOKEN=$ROOT_TOKEN vault secrets list -format=json" 2>/dev/null || echo "{}")

    if echo "$SECRETS_LIST" | jq -e '.["secret/"]' > /dev/null 2>&1; then
        log_info "KV secrets engine already enabled"
        return 0
    fi

    kubectl exec -n $NAMESPACE statefulset/vault -- sh -c "VAULT_TOKEN=$ROOT_TOKEN vault secrets enable -path=secret kv" || {
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
setup_keycloak() {
    log_info "Setting up Keycloak..."

    # Get the admin-api client secret from Vault secret
    KEYCLOAK_ADMIN_CLIENT_SECRET=$(kubectl get secret sunbird-rc -n $NAMESPACE -o jsonpath='{.data.keycloak-admin-client-secret}' 2>/dev/null | base64 -d)

    if [ -z "$KEYCLOAK_ADMIN_CLIENT_SECRET" ]; then
        log_error "keycloak-admin-client-secret not found in sunbird-rc secret"
        log_error "Make sure VaultStaticSecret has synced. Check: kubectl get secret sunbird-rc -n $NAMESPACE"
        return 0
    fi

    # Wait for Keycloak to be ready
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

    # Extra wait for realm import to complete
    log_info "Waiting for realm import to complete..."
    sleep 15

    # Get admin token
    log_info "Getting Keycloak admin token..."
    KEYCLOAK_ADMIN_PASSWORD=$(kubectl get secret sunbird-rc -n $NAMESPACE -o jsonpath='{.data.keycloak-admin-password}' 2>/dev/null | base64 -d)

    ADMIN_TOKEN=$(kube_curl curl -s -X POST \
        "http://keycloak:8080/auth/realms/master/protocol/openid-connect/token" \
        -d "username=admin&password=${KEYCLOAK_ADMIN_PASSWORD}&grant_type=password&client_id=admin-cli" | jq -r '.access_token')

    if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" == "null" ]; then
        log_error "Could not get Keycloak admin token"
        return 0
    fi

    # Update admin-api client secret
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
        log_info "admin-api client secret updated"
    else
        log_error "admin-api client not found in realm 'sunbird-rc'"
        return 0
    fi

    log_info "Keycloak setup complete"

    # Restart registry to pick up Keycloak
    log_info "Restarting registry..."
    kubectl rollout restart deployment/registry -n $NAMESPACE
}

# Setup MinIO bucket
setup_minio() {
    log_info "Setting up MinIO bucket..."

    # Wait for MinIO to be ready
    for i in {1..30}; do
        MINIO_STATUS=$(kubectl exec -n $NAMESPACE statefulset/file-storage -- curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/minio/health/live 2>/dev/null || echo "000")
        if [ "$MINIO_STATUS" == "200" ]; then
            log_info "MinIO is ready"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Create bucket
    kubectl exec -n $NAMESPACE statefulset/file-storage -- sh -c "
        mc alias set local http://localhost:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD 2>/dev/null && \
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
        if kubectl exec -n $NAMESPACE statefulset/kafka -- kafka-broker-api-versions --bootstrap-server localhost:9092 &> /dev/null; then
            log_info "Kafka is ready"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Create events topic
    kubectl exec -n $NAMESPACE statefulset/kafka -- kafka-topics \
        --create --if-not-exists \
        --topic events \
        --bootstrap-server localhost:9092 \
        --partitions 1 --replication-factor 1 2>/dev/null || true

    # Create entity topics used by registry
    for topic in create_entity; do
        kubectl exec -n $NAMESPACE statefulset/kafka -- kafka-topics \
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

# Build and push custom registry image with schemas baked in
build_registry_image() {
    log_info "Building custom registry image with schemas..."

    DOCKERFILE="${SCRIPT_DIR}/Dockerfile.registry"
    REGISTRY_HOST="${REGISTRY_HOST:-eu.gcr.io/akvo-lumen}"
    REGISTRY_IMAGE="${REGISTRY_HOST}/sunbird-rc/registry"
    IMAGE_TAG="latest-test"
    REGISTRY_IMAGE_FULL="${REGISTRY_IMAGE}:${IMAGE_TAG}"

    if [ ! -f "$DOCKERFILE" ]; then
        log_warn "Dockerfile.registry not found — using base image without schemas"
        return 0
    fi

    log_info "Building image: ${REGISTRY_IMAGE_FULL}"
    docker build -t "${REGISTRY_IMAGE_FULL}" -f "$DOCKERFILE" "$SCRIPT_DIR" || {
        log_error "Docker build failed"
        return 1
    }

    log_info "Pushing image..."
    docker push "${REGISTRY_IMAGE_FULL}" || {
        log_error "Docker push failed — ensure you have access to eu.gcr.io/akvo-lumen"
        return 1
    }

    log_info "Updating registry deployment..."
    kubectl set image deployment/registry registry="${REGISTRY_IMAGE_FULL}" -n $NAMESPACE

    log_info "Custom registry image deployed: ${REGISTRY_IMAGE_FULL}"
}

# Restart DID services
restart_did_services() {
    log_info "Restarting DID services..."
    kubectl rollout restart deployment/identity -n $NAMESPACE
    kubectl rollout restart deployment/credential -n $NAMESPACE
    kubectl rollout restart deployment/credential-schema -n $NAMESPACE
    log_info "DID services restarted"
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
    kubectl exec -n $NAMESPACE statefulset/vault -- vault status 2>/dev/null || echo "  Cannot connect to Vault"

    echo ""
    echo "Access URL: https://sunbird-rc.akvotest.org"
    echo "  Swagger:  https://sunbird-rc.akvotest.org/registry/swagger-ui.html"
    echo "  Keycloak: https://sunbird-rc.akvotest.org/auth/"
    echo "  Admin:    https://sunbird-rc.akvotest.org/admin/"
    echo ""
}

# Full configuration flow
configure() {
    echo ""
    echo "=========================================="
    echo "   SUNBIRD-RC GCP TEST CLUSTER SETUP    "
    echo "=========================================="
    echo ""

    check_prerequisites
    create_keycloak_realm_configmap

    wait_for_vault
    init_vault
    unseal_vault
    enable_kv_secrets
    create_vault_token_secret

    setup_keycloak
    setup_minio
    setup_kafka

    restart_did_services

    log_info "Waiting for services to stabilize..."
    sleep 30

    show_status

    echo ""
    log_info "Configuration complete!"
    echo ""
    log_warn "Remember to:"
    echo "  1. Backup $KEYS_FILE securely"
    echo "  2. Store unseal keys in a secure location"
    echo "  3. Optionally run: ./configure.sh --build-image  (to bake schemas into registry image)"
    echo ""
}

# Parse arguments
case "${1:-}" in
    --vault-init)
        check_prerequisites
        wait_for_vault
        init_vault
        unseal_vault
        enable_kv_secrets
        create_vault_token_secret
        ;;
    --keycloak)
        check_prerequisites
        create_keycloak_realm_configmap
        setup_keycloak
        ;;
    --minio)
        check_prerequisites
        setup_minio
        ;;
    --kafka)
        check_prerequisites
        setup_kafka
        ;;
    --build-image)
        check_prerequisites
        build_registry_image
        ;;
    --status)
        show_status
        ;;
    --help)
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  (none)          Full configuration"
        echo "  --vault-init    Only init/unseal Vault"
        echo "  --keycloak      Only setup Keycloak realm + client secret"
        echo "  --minio         Only setup MinIO bucket"
        echo "  --kafka         Only setup Kafka topics"
        echo "  --build-image   Build and push custom registry image"
        echo "  --status        Show status of all services"
        echo "  --help          Show this help"
        ;;
    *)
        configure
        ;;
esac
