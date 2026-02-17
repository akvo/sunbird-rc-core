# Sunbird-RC Kubernetes Deployment

Automated Kubernetes deployment for Sunbird-RC V2 registry on k3s, with all core and supporting services.

## Quick Start

```bash
# Full installation (first time)
./install.sh

# With external URL (for browser access via domain/IP)
EXTERNAL_URL="http://sunbird.example.com" ./install.sh

# Custom kubeconfig
KUBECONFIG=~/.kube/k3s-config ./install.sh

# Check status
./install.sh --status

# Test services
./install.sh --test

# Unseal Vault (after restart)
./install.sh --unseal
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Ingress (Traefik)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                   Nginx                                      │
│                              (Reverse Proxy)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
    │         │         │         │         │         │         │         │
    ▼         ▼         ▼         ▼         ▼         ▼         ▼         ▼
┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐
│Registry││Keycloak││Identity││Credent.││ Schema ││Claim-MS││ Admin  ││Metrics │
│ :8081  ││ :8080  ││ :3332  ││ :3000  ││ :3333  ││ :8082  ││ :3001  ││ :8070  │
└────────┘└────────┘└────────┘└────────┘└────────┘└────────┘└────────┘└────────┘
    │         │         │         │         │         │         │         │
    └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
                                      │
    ┌─────────────────────────────────┼─────────────────────────────────┐
    │                                 │                                 │
    ▼                                 ▼                                 ▼
┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│PostgreSQL││  Redis   ││  Kafka   ││Elastics. ││  Vault   ││  MinIO   │
│  :5432   ││  :6379   ││  :9092   ││  :9200   ││  :8200   ││  :9000   │
└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
```

## Services

### Core Services

| Service | Port | Description |
|---------|------|-------------|
| registry | 8081 | Core Sunbird-RC registry API |
| keycloak | 8080 | Identity and access management (with realm auto-import) |
| identity | 3332 | DID generation and resolution |
| credential | 3000 | Verifiable credential issuance |
| credential-schema | 3333 | Credential schema management |
| nginx | 80 | Reverse proxy / API gateway |

### Infrastructure Services

| Service | Port | Description |
|---------|------|-------------|
| db (PostgreSQL) | 5432 | Primary database |
| redis | 6379 | Caching layer |
| kafka | 9092 | Event streaming |
| es (Elasticsearch) | 9200 | Search indexing |
| vault | 8200 | Secrets and key management (production mode) |
| file-storage (MinIO) | 9000 | S3-compatible object storage |

### Additional Services

| Service | Port | Description |
|---------|------|-------------|
| claim-ms | 8082 | Claims management service |
| encryption-service | 8013 | Data encryption/decryption service |
| id-gen-service | 8088 | ID generation service |
| notification-ms | 8765 | Notification service (Kafka-based) |
| metrics | 8070 | Metrics collection service |
| clickhouse | 9000/8123 | Analytics database for metrics |
| admin-portal | 3001 | Admin UI portal |
| bulk-issuance | 5665 | Bulk credential issuance service |
| digilocker-certificate-api | 8087 | DigiLocker certificate integration |

## Directory Structure

```
k8s/
├── install.sh                  # Local k3s: deploy manifests + full configuration
├── configure-gke.sh            # GKE test cluster: post-deployment configuration only
├── README.md                   # This file
├── credentials.json            # Generated MinIO & Keycloak credentials (gitignored)
├── vault-keys.json             # Generated Vault unseal keys (gitignored)
├── base/
│   ├── kustomization.yaml      # Kustomize configuration
│   ├── namespace.yaml          # Namespace: sunbird-rc-namespace
│   ├── configmap.yaml          # ConfigMap + unified Secret (sunbird-rc)
│   ├── postgres.yaml           # PostgreSQL database
│   ├── redis.yaml              # Redis cache
│   ├── kafka.yaml              # Kafka + Zookeeper
│   ├── elasticsearch.yaml      # Elasticsearch
│   ├── vault.yaml              # HashiCorp Vault (dev mode, for kustomize base)
│   ├── vault-production.yaml   # HashiCorp Vault (production mode with PVC)
│   ├── vault-auto-unseal.yaml  # CronJob for automatic Vault unsealing
│   ├── keycloak.yaml           # Keycloak identity provider (with realm import)
│   ├── did-services.yaml       # Identity, Credential, Schema services
│   ├── registry.yaml           # Sunbird-RC core registry
│   ├── supporting-services.yaml # MinIO, public-key, context-proxy
│   ├── nginx.yaml              # Nginx reverse proxy + Ingress
│   ├── claim-ms.yaml           # Claims management service
│   ├── encryption-service.yaml # Encryption service
│   ├── id-gen-service.yaml     # ID generation service
│   ├── notification-ms.yaml    # Notification service
│   ├── metrics.yaml            # Metrics + ClickHouse
│   ├── admin-portal.yaml       # Admin portal UI
│   ├── bulk-issuance.yaml      # Bulk issuance service
│   └── digilocker.yaml         # DigiLocker certificate API
├── overlays/
│   ├── dev/                    # Development overlay (Vault dev mode)
│   └── production/             # Production overlay (persistent Vault)
└── scripts/
    ├── vault-init.sh           # Vault initialization helper
    └── vault-unseal.sh         # Vault unseal helper
```

## Environment Variables

`install.sh` accepts the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `KUBECONFIG` | `~/.kube/k3s-config` | Path to kubeconfig file |
| `EXTERNAL_URL` | _(empty)_ | External base URL for browser access (e.g. `http://sunbird.example.com`). When set, configures `KEYCLOAK_FRONTEND_URL` and `OAUTH2_RESOURCES_0_URI` so JWT token issuers match. |
| `LOCAL_REGISTRY` | `192.168.21.231:5000` | Docker registry host for the custom registry image |

## Installation Details

The `install.sh` script performs the following steps:

1. **Prerequisites Check** - Validates kubectl, cluster connectivity, jq
2. **Deploy Services** - Applies all manifests in order:
   - Namespace and ConfigMap/Secret
   - Credential generation (MinIO + Keycloak) and Secret patching
   - Infrastructure (PostgreSQL, Redis, Kafka, Elasticsearch)
   - Vault (production mode with PVC)
   - Keycloak realm ConfigMap (from `../imports/realm-export.json`)
   - Keycloak, DID services, Registry, supporting services
   - Additional services (Claim-MS, encryption, ID gen, etc.)
3. **Initialize Vault** - 5 key shares, 3 threshold (Shamir's Secret Sharing)
4. **Unseal Vault** - Automatically unseals using 3 of 5 generated keys
5. **Enable KV Secrets** - Configures Vault KV secrets engine at `secret/`
6. **Create Vault Token Secret** - Stores root token as k8s Secret for DID services
7. **Setup Auto-Unseal** - CronJob that runs every minute to unseal Vault after restarts
8. **Configure External URL** - If `EXTERNAL_URL` is set, patches Keycloak and Registry deployments
9. **Setup Keycloak** - Waits for realm import, updates admin-api client secret, disables SSL requirement
10. **Setup MinIO** - Creates `sunbird-rc` bucket with public download policy
11. **Setup Kafka** - Creates `events` and `create_entity` topics
12. **Build Registry Image** - Builds custom Docker image with schemas baked in via `Dockerfile.registry`, pushes to local registry, updates deployment
13. **Restart DID Services** - Restarts identity, credential, credential-schema to pick up Vault token
14. **Wait & Verify** - Waits for all 24 deployments to be ready, runs health tests

## Generated Files

### credentials.json
Contains randomly generated credentials (created on first install, reused on re-runs):
- MinIO access key and secret key
- Keycloak admin-api client secret

### vault-keys.json
Contains Vault initialization output:
- 5 unseal keys (base64 and hex encoded)
- Root token
- Threshold configuration (3 of 5 keys required)

**Important:** Back up these files securely. Both are gitignored.

## Secrets

All secrets are stored in a single Kubernetes Secret named `sunbird-rc` in the `sunbird-rc-namespace` namespace. Keys:

| Key | Description | Default |
|-----|-------------|---------|
| `postgres-password` | PostgreSQL password | `postgres` |
| `db-name` | Database name | `registry` |
| `db-user` | Database user | `postgres` |
| `db-password` | Database password (used by registry) | `postgres` |
| `keycloak-admin-password` | Keycloak admin password | `admin` |
| `keycloak-admin-client-secret` | admin-api client secret | _(generated by install.sh)_ |
| `minio-access-key` | MinIO access key | _(generated by install.sh)_ |
| `minio-secret-key` | MinIO secret key | _(generated by install.sh)_ |

The `install.sh` script patches `keycloak-admin-client-secret`, `minio-access-key`, and `minio-secret-key` with generated values from `credentials.json`.

## External URL Configuration

When accessing Sunbird-RC through a domain or external IP, the JWT token issuer (`iss` claim) must match between Keycloak and the Registry. Without `EXTERNAL_URL`, tokens are issued with an internal issuer (`http://keycloak:8080/auth/realms/sunbird-rc`), which works for internal service-to-service calls but fails when browsers obtain tokens via the external hostname.

Setting `EXTERNAL_URL` configures:
- **Keycloak**: `KEYCLOAK_FRONTEND_URL` = `<EXTERNAL_URL>/auth`
- **Registry**: `OAUTH2_RESOURCES_0_URI` = `<EXTERNAL_URL>/auth/realms/sunbird-rc`

This ensures the `iss` claim in JWT tokens matches what the registry expects, regardless of whether the token was obtained from inside the cluster or via the external URL.

## Vault Auto-Unseal

A CronJob runs every minute to check if Vault is sealed and automatically unseals it using the stored keys (from the `vault-unseal-keys` Secret). This ensures Vault remains operational after pod restarts.

## Access URLs

After installation, services are available through the Nginx reverse proxy:

| Service | URL |
|---------|-----|
| Registry API | `http://<HOST>/registry/` |
| Swagger UI | `http://<HOST>/registry/swagger-ui.html` |
| Keycloak Admin | `http://<HOST>/auth/` |
| Admin Portal | `http://<HOST>/admin/` |
| Claim-MS | `http://<HOST>/claim-ms/` |
| Notifications | `http://<HOST>/notification/` |
| Metrics | `http://<HOST>/metrics/` |

Where `<HOST>` is either `EXTERNAL_URL` (if set), the Traefik ingress IP, or `localhost`.

## Health Check

```bash
# Full health check
./install.sh --test

# Or manually check registry health
kubectl exec -n sunbird-rc-namespace deploy/nginx -- curl -s http://registry:8081/health | jq '.result'
```

Expected healthy response:
```json
{
  "healthy": true,
  "checks": [
    {"name": "sunbird.kafka.service", "healthy": true},
    {"name": "sunbird.file-storage.service", "healthy": true},
    {"name": "sunbird.elastic.service", "healthy": true},
    {"name": "sunbird.keycloak.service", "healthy": true},
    {"name": "DID_SERVICE", "healthy": true},
    {"name": "CREDENTIAL_SERVICE", "healthy": true},
    {"name": "CREDENTIAL_SCHEMA_SERVICE", "healthy": true}
  ]
}
```

## Common Operations

### View Logs
```bash
kubectl logs -n sunbird-rc-namespace deploy/registry -f
kubectl logs -n sunbird-rc-namespace deploy/keycloak -f
kubectl logs -n sunbird-rc-namespace deploy/identity -f
```

### Restart a Service
```bash
kubectl rollout restart deployment/registry -n sunbird-rc-namespace
```

### Check Pod Status
```bash
kubectl get pods -n sunbird-rc-namespace
```

### Manual Vault Unseal
```bash
./install.sh --unseal
```

### Delete Everything
```bash
kubectl delete namespace sunbird-rc-namespace
rm credentials.json vault-keys.json  # If you want fresh credentials on next install
```

## Configuration

### Namespace

All resources deploy to `sunbird-rc-namespace`. This is set in `base/namespace.yaml` and referenced throughout all manifests.

### ConfigMap and Secret

`base/configmap.yaml` contains:
- `sunbird-rc-config` ConfigMap: PostgreSQL settings, Vault address, and identity service signing keys
- `sunbird-rc` Secret: all credentials (database, Keycloak, MinIO)

### Registry Configuration (registry.yaml)
- Database connection (via Secret refs for user/password)
- Keycloak integration (OAuth2 resource URI)
- Service endpoints (DID, Credential, Schema, Encryption, ID Gen, Notification)
- Feature flags (encryption, claims, certificates, notifications, etc.)

### Keycloak Setup
- Realm: `sunbird-rc` (auto-imported from `../imports/realm-export.json` via ConfigMap)
- Clients: `admin-api` (confidential, service account enabled), `registry-frontend` (public)
- Admin credentials: admin/admin (change in production)
- SSL requirement: disabled by `install.sh` (TLS is terminated at ingress)

### Custom Registry Image
`install.sh` builds a custom registry Docker image using `../Dockerfile.registry` which bakes in entity schemas from the repository. The image is pushed to a local Docker registry and the deployment is updated to use it.

## Production Considerations

1. **TLS/HTTPS** - Add cert-manager and configure TLS on ingress
2. **Database HA** - Use managed PostgreSQL or CloudNativePG operator
3. **Credentials** - Change default passwords in `configmap.yaml` Secret section
4. **Replicas** - Scale stateless services (registry, nginx, keycloak)
5. **Resource Limits** - Already configured for registry, add to other services
6. **Backups** - Configure PostgreSQL and MinIO backup jobs
7. **Monitoring** - Add Prometheus/Grafana for observability
8. **Network Policies** - Restrict pod-to-pod communication
9. **External Secrets** - Use external secrets operator for credential management
