#!/bin/bash
#
# Vault Unseal Script
#
# Use this script after Vault pod restarts to unseal it
#

set -e

NAMESPACE="sunbird-rc"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config}"

export KUBECONFIG

echo "=== Vault Unseal ==="
echo ""

# Check if vault is sealed
SEAL_STATUS=$(kubectl exec -n $NAMESPACE vault-0 -- vault status -format=json 2>/dev/null | jq -r '.sealed' || echo "unknown")

if [ "$SEAL_STATUS" == "false" ]; then
    echo "Vault is already unsealed."
    exit 0
fi

if [ "$SEAL_STATUS" == "unknown" ]; then
    echo "Error: Cannot connect to Vault. Is the pod running?"
    exit 1
fi

echo "Vault is sealed. Enter 3 unseal keys to unseal."
echo ""

for i in 1 2 3; do
    read -sp "Unseal Key $i: " KEY
    echo ""
    kubectl exec -n $NAMESPACE vault-0 -- vault operator unseal "$KEY" > /dev/null

    # Check if unsealed
    SEAL_STATUS=$(kubectl exec -n $NAMESPACE vault-0 -- vault status -format=json 2>/dev/null | jq -r '.sealed')
    if [ "$SEAL_STATUS" == "false" ]; then
        echo ""
        echo "✅ Vault unsealed successfully!"
        exit 0
    fi
done

echo ""
echo "Vault may still be sealed. Check status:"
kubectl exec -n $NAMESPACE vault-0 -- vault status
