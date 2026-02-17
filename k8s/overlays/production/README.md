# Production Deployment

This overlay deploys Sunbird-RC with production-ready Vault.

## Prerequisites

- Kubernetes cluster (k3s, EKS, GKE, AKS, etc.)
- kubectl configured
- Storage class available for PVCs

## Deployment Steps

### 1. Deploy the stack (Vault will be uninitialized)

```bash
kubectl apply -k /path/to/k8s/overlays/production
```

### 2. Wait for Vault pod to be running

```bash
kubectl wait --for=condition=ready pod -l app=vault -n sunbird-rc --timeout=120s
```

### 3. Initialize Vault

```bash
# Option A: Use the helper script
./scripts/vault-init.sh

# Option B: Manual initialization
kubectl exec -it vault-0 -n sunbird-rc -- vault operator init -key-shares=5 -key-threshold=3
```

**IMPORTANT:** Save the unseal keys and root token securely!

### 4. Unseal Vault

```bash
# Enter 3 of 5 unseal keys
kubectl exec -it vault-0 -n sunbird-rc -- vault operator unseal
kubectl exec -it vault-0 -n sunbird-rc -- vault operator unseal
kubectl exec -it vault-0 -n sunbird-rc -- vault operator unseal
```

### 5. Enable KV secrets engine

```bash
kubectl exec -it vault-0 -n sunbird-rc -- sh -c 'VAULT_TOKEN=<root_token> vault secrets enable -path=secret kv'
```

### 6. Create vault token secret for identity service

```bash
kubectl create secret generic vault-token \
  --from-literal=token=<YOUR_ROOT_TOKEN> \
  -n sunbird-rc
```

### 7. Restart identity service

```bash
kubectl rollout restart deployment/identity -n sunbird-rc
```

## After Pod Restart

Vault needs to be unsealed after every restart:

```bash
./scripts/vault-unseal.sh
# or manually:
kubectl exec -it vault-0 -n sunbird-rc -- vault operator unseal
```

## Auto-Unseal (Optional)

For automatic unsealing, configure one of:
- AWS KMS
- Azure Key Vault
- GCP Cloud KMS
- HashiCorp Vault Transit

See: https://developer.hashicorp.com/vault/docs/configuration/seal

## Backup

Backup the vault data regularly:

```bash
kubectl exec -n sunbird-rc vault-0 -- tar czf - /vault/data > vault-backup.tar.gz
```
