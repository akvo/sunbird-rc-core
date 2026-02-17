#!/bin/bash
#
# Vault Production Initialization Script
#
# This script initializes and unseals Vault for production use
#

set -e

NAMESPACE="sunbird-rc"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config}"
VAULT_KEYS_FILE="${VAULT_KEYS_FILE:-vault-keys.json}"

export KUBECONFIG

echo "=== Vault Production Initialization ==="
echo ""

# Wait for vault pod to be running
echo "1. Waiting for Vault pod to be running..."
kubectl wait --for=condition=ready pod -l app=vault -n $NAMESPACE --timeout=120s 2>/dev/null || true

# Check if vault is already initialized
echo ""
echo "2. Checking Vault status..."
INIT_STATUS=$(kubectl exec -n $NAMESPACE vault-0 -- vault status -format=json 2>/dev/null | jq -r '.initialized' || echo "false")

if [ "$INIT_STATUS" == "true" ]; then
    echo "   Vault is already initialized."

    SEAL_STATUS=$(kubectl exec -n $NAMESPACE vault-0 -- vault status -format=json 2>/dev/null | jq -r '.sealed')
    if [ "$SEAL_STATUS" == "true" ]; then
        echo "   Vault is sealed. Please unseal with: $0 unseal"
    else
        echo "   Vault is unsealed and ready."
    fi
    exit 0
fi

echo ""
echo "3. Initializing Vault..."
echo "   This will generate unseal keys and root token."
echo ""

# Initialize Vault with 5 key shares and 3 key threshold
INIT_OUTPUT=$(kubectl exec -n $NAMESPACE vault-0 -- vault operator init -key-shares=5 -key-threshold=3 -format=json)

# Save keys to file
echo "$INIT_OUTPUT" > "$VAULT_KEYS_FILE"
chmod 600 "$VAULT_KEYS_FILE"

echo "   ✅ Vault initialized successfully!"
echo ""
echo "   ⚠️  IMPORTANT: Keys saved to: $VAULT_KEYS_FILE"
echo "   ⚠️  Store these keys securely and DELETE this file!"
echo ""

# Extract keys for display
ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')
UNSEAL_KEY_1=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
UNSEAL_KEY_2=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[1]')
UNSEAL_KEY_3=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[2]')

echo "=== SAVE THESE SECURELY ==="
echo ""
echo "Root Token: $ROOT_TOKEN"
echo ""
echo "Unseal Keys (need 3 of 5):"
echo "  Key 1: $UNSEAL_KEY_1"
echo "  Key 2: $UNSEAL_KEY_2"
echo "  Key 3: $UNSEAL_KEY_3"
echo "  (Keys 4 & 5 in $VAULT_KEYS_FILE)"
echo ""

# Unseal Vault
echo "4. Unsealing Vault..."
kubectl exec -n $NAMESPACE vault-0 -- vault operator unseal "$UNSEAL_KEY_1" > /dev/null
kubectl exec -n $NAMESPACE vault-0 -- vault operator unseal "$UNSEAL_KEY_2" > /dev/null
kubectl exec -n $NAMESPACE vault-0 -- vault operator unseal "$UNSEAL_KEY_3" > /dev/null

echo "   ✅ Vault unsealed!"
echo ""

# Enable KV secrets engine
echo "5. Enabling KV secrets engine at 'secret/'..."
kubectl exec -n $NAMESPACE vault-0 -- sh -c "VAULT_TOKEN=$ROOT_TOKEN vault secrets enable -path=secret kv" 2>/dev/null || echo "   (Already enabled or skipped)"

echo ""
echo "=== Vault is ready for production! ==="
echo ""
echo "Next steps:"
echo "  1. Update your .env or secrets with the new root token"
echo "  2. Store unseal keys in separate secure locations"
echo "  3. Delete $VAULT_KEYS_FILE after securing the keys"
echo "  4. Update identity service VAULT_TOKEN"
echo ""
echo "To check status: kubectl exec -n $NAMESPACE vault-0 -- vault status"
