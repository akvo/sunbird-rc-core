# Sunbird RC Setup Guide

This document chronicles the complete setup process for Sunbird RC, including all challenges encountered and their solutions.

**Note**: This is an improved fork of [Sunbird-RC/sunbird-rc-core](https://github.com/Sunbird-RC/sunbird-rc-core) with automated setup scripts, enhanced documentation, and fixes for common issues.

## Table of Contents
- [Initial Setup](#initial-setup)
- [Fork Improvements](#fork-improvements)
- [Additional Changes](#additional-changes)
- [Challenges and Solutions](#challenges-and-solutions)
- [Admin Portal Configuration](#admin-portal-configuration)
- [Final Configuration](#final-configuration)
- [Usage](#usage)

---

## Quick Start

For experienced users who want to get started quickly:

```bash
# 1. Clone this fork (includes automated setup)
gh repo clone dedenbangkit/sunbird-rc-core && cd sunbird-rc-core

# 2. Start services using automated script
./start-sunbird.sh

# 3. Access Admin Portal
# URL: http://localhost:3001
# Credentials: admin / admin123 (in sunbird-rc realm)
```

**Why use this fork?**
- ✅ Automated vault unsealing script
- ✅ Pre-configured admin portal with nginx fixes
- ✅ Fixed PostgreSQL version compatibility
- ✅ Comprehensive documentation
- ✅ Security-hardened .gitignore

For detailed setup and troubleshooting, continue reading below.

---

## Initial Setup

### 1. Repository Clone
```bash
# Clone this improved fork
gh repo clone dedenbangkit/sunbird-rc-core
cd sunbird-rc-core

# Or clone the original (requires manual setup)
# gh repo clone Sunbird-RC/sunbird-rc-core
```

### 2. Initial Environment Configuration

Created `.env` file with:
```bash
RELEASE_VERSION=v2.0.2
VAULT_TOKEN=<your-vault-root-token-from-keys.txt>
```

**Note**: Initially used `v2.0.0-rc1` but updated to `v2.0.2` (latest stable) after encountering docker manifest errors.

---

## Fork Improvements

This fork includes several improvements over the original repository:

### 1. Automated Startup Script (`start-sunbird.sh`)
**Problem**: Vault requires manual unsealing after every restart, blocking dependent services.

**Solution**: Created automated script that:
- Starts all Docker services
- Waits for vault initialization
- Automatically unseals vault with stored keys
- Starts dependent services in correct order
- Displays service status

**Usage**: Simply run `./start-sunbird.sh` instead of `docker compose up -d`

### 2. Admin Portal Integration
**Problem**: Admin portal is a separate project, confusing to set up.

**Solution**: Integrated admin-portal directly into docker-compose.yml with:
- Custom nginx configuration (`admin-portal-nginx.conf`)
- Proxy redirect fixes for Keycloak authentication
- Proper service dependencies

**Access**: http://localhost:3001 (auto-configured)

### 3. Security Improvements
**Problem**: Sensitive files (vault keys, .env) not protected in .gitignore.

**Solution**: Enhanced .gitignore to protect:
- `keys.txt` - Vault unseal keys
- `.env` - Environment variables with secrets
- `.claude/` - AI assistant configuration
- Data directories (db-data, vault-data, etc.)

### 4. PostgreSQL Version Fix
**Problem**: Default `postgres:latest` pulls v18+ with incompatible data format.

**Solution**: Pinned to `postgres:16` in docker-compose.yml for stability.

### 5. Comprehensive Documentation
**Problem**: Limited setup documentation, many trial-and-error steps.

**Solution**: This complete guide documenting:
- All setup challenges and solutions
- Keycloak realm configuration
- Schema creation workflow
- Troubleshooting common issues

---

## Additional Changes

### Custom WaterFacility Schema

A custom `WaterFacility` schema has been added to demonstrate registry capabilities with Indonesian administrative location structure.

**Schema Location**: `java/registry/src/main/resources/public/_schemas/WaterFacility.json`

**Key Features**:
- Nested `location` object with `province`, `district`, `village`
- Enumerated facility types (Water Treatment Plant, Reservoir, Pumping Station, Distribution Center, Desalination Plant)
- Auto-generated `wfId` unique identifier

**Schema Structure**:
```json
{
  "properties": {
    "wfId": { "type": "string", "description": "System-generated unique ID" },
    "wfName": { "type": "string" },
    "typeOfWaterFacility": { "type": "string", "enum": [...] },
    "location": {
      "type": "object",
      "properties": {
        "province": { "type": "string" },
        "district": { "type": "string" },
        "village": { "type": "string" }
      }
    },
    "institution": { "type": "string" },
    "foundingDate": { "type": "string", "format": "date" },
    "waterCapacity": { "type": "number", "maximum": 1000000 }
  }
}
```

### Custom wfId Generation

**Problem**: Default Sunbird RC ID generation uses external id-gen-service with sequential IDs, which doesn't provide meaningful, deterministic identifiers.

**Solution**: Implemented custom `IIdGenService` that generates deterministic wfId values based on entity attributes.

**wfId Format**: `WF-<PROVINCE_ABBR>-<DISTRICT_ABBR>-<TYPE_CODE>-<HASH>`

**Example**: `WF-JAW-KOT-WTP-66EB8D`

**Components**:
| Component | Description | Example |
|-----------|-------------|---------|
| `WF-` | Fixed prefix | WF- |
| `PROVINCE_ABBR` | First 3 alphanumeric chars of province (uppercase) | JAW (Jawa Barat) |
| `DISTRICT_ABBR` | First 3 alphanumeric chars of district (uppercase) | KOT (Kota Bandung) |
| `TYPE_CODE` | Facility type abbreviation | WTP, RES, PS, DC, DES |
| `HASH` | 6-char SHA-256 hash of normalized attributes | 66EB8D |

**Facility Type Codes**:
- `WTP` - Water Treatment Plant
- `RES` - Reservoir
- `PS` - Pumping Station
- `DC` - Distribution Center
- `DES` - Desalination Plant

**Hash Inputs** (normalized to lowercase, trimmed):
- wfName
- typeOfWaterFacility
- location.province
- location.district
- location.village

### Duplicate Rejection

**Problem**: The `uniqueIndexFields` constraint is checked before ID generation, so it can't prevent duplicates based on generated IDs.

**Solution**: Application-level duplicate checking in `WaterFacilityIdGenService` that queries for existing entities with the same wfId before allowing creation.

**Behavior**:
- First creation: **SUCCESS** - Facility created with generated wfId
- Duplicate attempt (same name, type, location): **REJECTED** with error message

**Error Response**:
```json
{
  "params": {
    "status": "UNSUCCESSFUL",
    "errmsg": "Duplicate WaterFacility: A facility with wfId 'WF-JAW-KOT-WTP-66EB8D' already exists. Facilities with the same name, type, and location are not allowed."
  }
}
```

### Implementation Files

Three new Java files were created for the custom ID generation:

**1. EntityDataHolder.java**
```
java/registry/src/main/java/dev/sunbirdrc/registry/service/impl/EntityDataHolder.java
```
ThreadLocal holder for passing entity data between AOP aspect and ID generation service.

**2. EntityDataCaptureAspect.java**
```
java/registry/src/main/java/dev/sunbirdrc/registry/aspect/EntityDataCaptureAspect.java
```
Spring AOP aspect that intercepts `RegistryServiceImpl.addEntity()` to capture entity data before ID generation.

**3. WaterFacilityIdGenService.java**
```
java/registry/src/main/java/dev/sunbirdrc/registry/service/impl/WaterFacilityIdGenService.java
```
Custom `IIdGenService` implementation with `@Primary` annotation that:
- Generates deterministic wfId based on entity attributes
- Checks for duplicates before allowing creation
- Uses `@Lazy` injection to avoid circular dependencies

### Building Custom Registry

After modifying Java files, use the build script:

```bash
# Automated build script (recommended)
./build-registry.sh
```

This script will:
1. Build the JAR using Maven
2. Build the Docker image (`sunbird-rc-core:local`)
3. Optionally restart the registry service

**Manual build** (if needed):
```bash
# Build the JAR
cd java && ./mvnw package -DskipTests -pl registry -am

# Build Docker image
docker build -t sunbird-rc-core:local -f java/registry/Dockerfile java/registry

# Restart registry
export IDGEN_ENABLED=true && docker compose up -d registry
```

The `docker-compose.yml` is configured to use the local image:
```yaml
registry:
  image: sunbird-rc-core:local
```

### Testing wfId Generation

```bash
# Create a WaterFacility
curl -X POST http://localhost:8081/api/v1/WaterFacility \
  -H "Content-Type: application/json" \
  -d '{
    "wfName": "IPAM Dago Pakar",
    "typeOfWaterFacility": "Water Treatment Plant",
    "location": {
      "province": "Jawa Barat",
      "district": "Kota Bandung",
      "village": "Dago"
    },
    "institution": "PDAM Tirtawening",
    "foundingDate": "2018-06-15",
    "waterCapacity": 50000
  }'

# Verify the generated wfId
curl http://localhost:8081/api/v1/WaterFacility | jq '.data[0].wfId'
# Output: "WF-JAW-KOT-WTP-66EB8D"

# Attempt duplicate (will be rejected)
curl -X POST http://localhost:8081/api/v1/WaterFacility \
  -H "Content-Type: application/json" \
  -d '{
    "wfName": "IPAM Dago Pakar",
    "typeOfWaterFacility": "Water Treatment Plant",
    "location": {
      "province": "Jawa Barat",
      "district": "Kota Bandung",
      "village": "Dago"
    },
    "institution": "Different Institution",
    "foundingDate": "2024-01-01",
    "waterCapacity": 99999
  }'
# Response: status "UNSUCCESSFUL" with duplicate error
```

### Jupyter Notebook Demo

A comprehensive demo notebook is available:

**File**: `sunbird-rc-water-facility-demo.ipynb`

**Features**:
- CRUD operations for WaterFacility
- wfId generation demonstration
- Duplicate rejection testing
- Bulk creation with wfId display
- Export to CSV
- Indonesian test data (Jawa Barat, Banten, DKI Jakarta, Bali)

---

## Challenges and Solutions

### Challenge 1: PostgreSQL Version Compatibility

**Problem**: PostgreSQL container failed with error:
```
in 18+, these Docker images are configured to store database data in
a format which is compatible with pg_ctlcluster
```

**Root Cause**: The `image: postgres` in docker-compose.yml was pulling PostgreSQL 18+, which has incompatible data format changes.

**Solution**: Pin PostgreSQL to version 16
```yaml
# docker-compose.yml line 31
db:
  image: postgres:16  # Changed from: image: postgres
```

**Additional Action**: Removed existing `db-data` directory to start fresh.

---

### Challenge 2: Vault Service Initialization

**Problem**: Vault service was unhealthy, blocking dependent services.

**Error**: `security barrier not initialized`

**Solution**: Manual Vault initialization and unsealing

```bash
# 1. Initialize Vault
docker compose exec -T vault vault operator init > keys.txt

# 2. Unseal Vault (need 3 of 5 keys)
docker compose exec -T vault vault operator unseal <unseal_key_1>
docker compose exec -T vault vault operator unseal <unseal_key_2>
docker compose exec -T vault vault operator unseal <unseal_key_3>

# 3. Enable KV secrets engine
export VAULT_TOKEN=<root_token>
docker compose exec -T vault vault login $VAULT_TOKEN
docker compose exec -T vault vault secrets enable -path=kv kv-v2

# 4. Update .env with VAULT_TOKEN
echo "VAULT_TOKEN=<root_token>" >> .env
```

**Important**: Save `keys.txt` securely - contains unseal keys and root token.

---

### Challenge 3: Understanding the UI Components

**Confusion**: Accessing `http://localhost:8081` showed 404 errors, and there was confusion about the verification UI vs. admin interface.

**Clarification**:
- **Port 8081**: Registry API (backend service, not a user interface)
- **Port 80**: Verification UI (public-facing certificate verification)
- **Admin Portal**: Separate application that needed to be configured

---

### Challenge 4: Schema Creation Method

**Problem**: Attempted to create schemas via POST `/api/v1/Schema` API endpoint but received validation errors.

**Misconception**: Thought schemas could be created via REST API like typical CRUD operations.

**Reality**: Sunbird RC uses file-based schema definitions.

**Solution**: Created schema files in the correct directory structure:
```bash
# Schema location
java/registry/src/main/resources/public/_schemas/DegreeCertificate.json
```

**Example Schema**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "type": "object",
  "properties": {
    "DegreeCertificate": {
      "$ref": "#/definitions/DegreeCertificate"
    }
  },
  "required": ["DegreeCertificate"],
  "title": "DegreeCertificate",
  "definitions": {
    "DegreeCertificate": {
      "type": "object",
      "title": "University Degree Certificate",
      "required": ["studentName", "studentId", "degree", "university"],
      "properties": {
        "studentName": {"type": "string"},
        "studentId": {"type": "string"},
        "degree": {"type": "string", "enum": ["Bachelor", "Master", "PhD"]},
        "university": {"type": "string"}
      }
    }
  },
  "_osConfig": {
    "indexFields": ["studentId"],
    "uniqueIndexFields": ["certificateNumber"]
  }
}
```

**Important**: After adding schema files, restart the registry service:
```bash
docker compose restart registry
```

---

### Challenge 5: Admin Portal Integration

**Problem**: Admin Portal is a separate application not included in default docker-compose.yml.

**Initial Approach**: Tried to set up in a separate directory with standalone docker-compose.

**User Feedback**: Preferred integrating directly into main docker-compose.yml to avoid confusion.

**Solution**: Added admin-portal service to existing docker-compose.yml:
```yaml
admin-portal:
  image: ghcr.io/sunbird-rc/sunbird-rc-admin-portal:main
  ports:
    - "3001:80"
  volumes:
    - ./admin-portal-nginx.conf:/etc/nginx/conf.d/default.conf:ro
  environment:
    - REGISTRY_URL=http://registry:8081
    - KEYCLOAK_URL=http://localhost:8080/auth
  depends_on:
    registry:
      condition: service_healthy
    keycloak:
      condition: service_healthy
```

---

### Challenge 6: Keycloak Client Configuration

**Problem**: Accessing Admin Portal showed error: "We are sorry... Client not found"

**Root Cause**: The `admin-portal` OAuth client didn't exist in Keycloak's sunbird-rc realm.

**Attempted Solutions**:
1. ❌ Added client to `imports/realm-export.json` and restarted Keycloak - didn't work (realm-export only imported on first initialization with empty DB)
2. ❌ Tried using Keycloak admin CLI inside container - connection refused
3. ❌ Tried curl with bash variables - shell parsing errors

**Working Solution**: Created bash script to use Keycloak Admin REST API:
```bash
#!/bin/bash

# Get access token
ACCESS_TOKEN=$(curl -s -X POST "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

# Create admin-portal client
curl -X POST "http://localhost:8080/auth/admin/realms/sunbird-rc/clients" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "admin-portal",
    "enabled": true,
    "publicClient": true,
    "redirectUris": ["http://localhost:3001/*", "http://localhost:3001"],
    "webOrigins": ["http://localhost:3001"],
    "protocol": "openid-connect",
    "directAccessGrantsEnabled": true,
    "standardFlowEnabled": true,
    "implicitFlowEnabled": false,
    "fullScopeAllowed": true
  }'
```

**Lesson Learned**: Writing commands to script files avoids bash variable expansion and quoting issues.

---

### Challenge 7: Browser Redirect to Internal Docker Hostname

**Problem**: Admin Portal redirected browser to `http://keycloak:8080`, which is not resolvable from the host machine.

**Root Cause**:
- Admin Portal uses nginx as reverse proxy
- Nginx proxied `/auth/` to `http://keycloak:8080/auth/` (internal Docker network)
- Keycloak returned redirect responses with `Location: http://keycloak:8080/...`
- Browser couldn't resolve the internal Docker hostname

**Initial Attempt**: Changed `KEYCLOAK_URL` environment variable - didn't work because the issue was in Keycloak's redirect responses, not the initial connection.

**Analysis**:
- Frontend config.json uses relative path: `"url": "/auth"`
- Nginx proxies this to internal Keycloak service
- Problem was in HTTP redirect headers from Keycloak

**Solution**: Created custom nginx configuration with `proxy_redirect` directive:

**File: `admin-portal-nginx.conf`**
```nginx
server {
    listen 80;

    location / {
        root   /usr/share/nginx/html/admin;
        index  index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    location /registry/ {
        proxy_pass http://registry:8081/;
    }

    location /auth/ {
        proxy_pass          http://keycloak:8080/auth/;
        proxy_set_header    Host $host;
        proxy_set_header    X-Real-IP $remote_addr;
        proxy_set_header    X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto $scheme;
        proxy_set_header    X-Forwarded-Host $host;
        proxy_set_header    X-Forwarded-Port $server_port;

        # KEY FIX: Rewrite redirect responses
        proxy_redirect http://keycloak:8080/ http://$host:$server_port/;
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
```

**Key Directive**: `proxy_redirect http://keycloak:8080/ http://$host:$server_port/;`
- Rewrites Location headers in Keycloak responses
- Replaces `http://keycloak:8080/` with `http://localhost:3001/` (or whatever host browser uses)

**Important**: Must recreate container (not just restart) to pick up volume mount:
```bash
docker compose up -d admin-portal
```

---

### Challenge 8: No Users in Sunbird RC Realm

**Problem**: Login failed with "invalid username or password" even with correct Keycloak master realm credentials.

**Root Cause**:
- Keycloak has multiple realms: `master` and `sunbird-rc`
- Credentials `admin/admin` work for **master realm** (Keycloak administration)
- Admin Portal authenticates against **sunbird-rc realm** (application realm)
- No users existed in sunbird-rc realm initially

**Verification**:
```bash
# Check users in realm
ACCESS_TOKEN=$(curl -s -X POST "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" -d "password=admin" -d "grant_type=password" \
  -d "client_id=admin-cli" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

curl -s "http://localhost:8080/auth/admin/realms/sunbird-rc/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
# Result: [] (empty array)
```

**Solution**: Create admin user in sunbird-rc realm via API:
```bash
#!/bin/bash

ACCESS_TOKEN=$(curl -s -X POST "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" -d "password=admin" -d "grant_type=password" \
  -d "client_id=admin-cli" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

# Create user with credentials
curl -X POST "http://localhost:8080/auth/admin/realms/sunbird-rc/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "enabled": true,
    "emailVerified": true,
    "email": "admin@example.com",
    "firstName": "Admin",
    "lastName": "User",
    "credentials": [{
      "type": "password",
      "value": "admin123",
      "temporary": false
    }]
  }'
```

**Keycloak Realm Concept**:
- **Master Realm**: Administrative realm for managing Keycloak itself
- **Application Realms** (e.g., sunbird-rc): Separate user bases for different applications
- Users in master realm cannot log into application realms and vice versa

---

## Admin Portal Configuration

### Directory Structure
```
sunbird-rc-core/
├── docker-compose.yml          # Main orchestration (modified)
├── admin-portal-nginx.conf     # Custom nginx config (created)
├── start-sunbird.sh            # Automated startup script (created)
├── .env                        # Environment variables (modified)
├── keys.txt                    # Vault keys (created, keep secure!)
└── java/registry/src/main/resources/public/_schemas/
    └── DegreeCertificate.json  # Example schema (created)
```

### Custom Nginx Configuration

The `admin-portal-nginx.conf` file is crucial for proper operation. It:
1. Serves the Admin Portal frontend
2. Proxies `/registry/` requests to the Registry API
3. Proxies `/auth/` requests to Keycloak
4. **Rewrites redirect URLs** from internal Docker hostnames to browser-accessible URLs

---

## Final Configuration

### Services Overview

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Database |
| Elasticsearch | 9200 | Search engine |
| Vault | 8200 | Secrets management |
| Keycloak | 8080 | Identity & access management |
| Registry API | 8081 | Core Sunbird RC API |
| Admin Portal | 3001 | Management interface |
| Verification UI | 80 | Public certificate verification |
| MinIO | 9000, 9001 | File storage |

### Access Points

- **Admin Portal**: http://localhost:3001
- **Keycloak Admin**: http://localhost:8080/auth/admin
- **Registry API**: http://localhost:8081/api/v1
- **Verification UI**: http://localhost:80

### Credentials

**Keycloak Master Realm** (for Keycloak administration):
- Username: `admin`
- Password: `admin`
- URL: http://localhost:8080/auth/admin

**Sunbird RC Realm** (for Admin Portal):
- Username: `admin`
- Password: `admin123`
- URL: http://localhost:3001

**Database**:
- Username: `postgres`
- Password: `postgres`
- Database: `registry`

**MinIO**:
- Access Key: `admin`
- Secret Key: `12345678`

**Vault**:
- Token: Stored in `keys.txt` and `.env`
- Unseal Keys: Stored in `keys.txt` (need 3 of 5 to unseal)

---

## Usage

### Starting the System

**Recommended Method** (automated):
```bash
# Use the startup script that handles vault unsealing
./start-sunbird.sh
```

This script will:
1. Start all Docker services
2. Wait for Vault to be ready
3. Automatically unseal Vault with the saved keys
4. Start dependent services (identity, credential-schema, etc.)
5. Display service status

**Manual Method**:
```bash
# Start all services
docker compose up -d

# Unseal vault (required after every restart)
docker exec sunbird-rc-core-vault-1 vault operator unseal <key1>
docker exec sunbird-rc-core-vault-1 vault operator unseal <key2>
docker exec sunbird-rc-core-vault-1 vault operator unseal <key3>

# Start dependent services
docker compose up -d identity credential-schema claim-ms nginx metrics admin-portal
```

**Check Status**:
```bash
# Check service status
docker compose ps

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f admin-portal
docker compose logs -f keycloak
docker compose logs -f registry
```

**Known Issue**: The `credential` service may fail to start in v2.0.2 due to a dependency injection bug. This doesn't affect core registry functionality or the admin portal.

### Creating Schemas

1. Create schema JSON file in `java/registry/src/main/resources/public/_schemas/`
2. Follow JSON Schema draft-07 specification
3. Include `_osConfig` section for Sunbird RC-specific configuration
4. Restart registry service: `docker compose restart registry`
5. Verify schema loaded: `curl http://localhost:8081/api/docs/swagger.json`

### Creating Entities (Credentials)

```bash
# Example: Create a degree certificate
curl -X POST http://localhost:8081/api/v1/DegreeCertificate \
  -H "Content-Type: application/json" \
  -d '{
    "studentName": "John Doe",
    "studentId": "STU001",
    "degree": "Bachelor",
    "major": "Computer Science",
    "university": "Example University",
    "graduationDate": "2024-06-15",
    "certificateNumber": "CERT2024001"
  }'
```

### Accessing Admin Portal

1. Navigate to http://localhost:3001
2. Click login - will redirect to Keycloak
3. Enter credentials: `admin` / `admin123`
4. After authentication, redirected back to Admin Portal
5. Can now manage schemas, view entities, issue credentials

### Stopping the System

```bash
# Stop all services
docker compose down

# Stop and remove volumes (complete cleanup)
docker compose down -v

# Remove specific service data
rm -rf db-data/
```

---

## Troubleshooting

### Service Won't Start

**Check dependencies**:
```bash
docker compose ps
```

If a service is unhealthy, check its logs:
```bash
docker compose logs service-name
```

### Vault Unsealing After Restart

**Important**: Vault automatically seals itself when stopped/restarted. This is by design for security.

**Recommended Solution**: Use the automated startup script:
```bash
./start-sunbird.sh
```

**Manual Unsealing** (if needed):
```bash
# Get the 3 unseal keys from keys.txt (lines 5-7)
docker exec sunbird-rc-core-vault-1 vault operator unseal <key1>
docker exec sunbird-rc-core-vault-1 vault operator unseal <key2>
docker exec sunbird-rc-core-vault-1 vault operator unseal <key3>

# Verify vault is unsealed
docker exec sunbird-rc-core-vault-1 vault status
```

**Why this happens**:
- Vault uses Shamir's Secret Sharing (5 keys, need 3 to unseal)
- Prevents unauthorized access if the server is compromised
- In production, use cloud auto-unseal features

### Schema Not Loading

1. Check file is in correct directory
2. Validate JSON syntax
3. Restart registry: `docker compose restart registry`
4. Check logs: `docker compose logs registry`

### Admin Portal Issues

**Can't access**: Check nginx config is mounted:
```bash
docker compose exec admin-portal cat /etc/nginx/conf.d/default.conf
```

**Still redirecting to keycloak:8080**:
- Verify `proxy_redirect` directive in nginx config
- Recreate container: `docker compose up -d admin-portal`

**Login fails**:
- Verify user exists in sunbird-rc realm
- Use scripts in `/tmp/check-keycloak-users.sh` and `/tmp/create-admin-user-v2.sh`

### Port Conflicts

If ports are already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "3002:80"  # Change 3001 to 3002 for admin-portal
```

---

## Key Learnings

1. **PostgreSQL Versioning**: Always pin database versions in production to avoid breaking changes
2. **Vault Initialization**: Vault requires manual setup and unsealing - automate for production
3. **Docker Networking**: Internal hostnames (keycloak, registry) only work within Docker network
4. **Nginx Proxy Configuration**: `proxy_redirect` is essential for rewriting internal URLs in responses
5. **Keycloak Realms**: Master realm ≠ application realm; users must be created in correct realm
6. **Schema Management**: File-based, not API-based; requires service restart
7. **Container Restarts**: Restart vs recreate matters - volume mounts need recreation
8. **OAuth Flow**: Admin Portal is public client using OAuth2 authorization code flow

---

## Production Considerations

### Security

- [ ] Change all default passwords
- [ ] Use proper secrets management (not .env files)
- [ ] Enable HTTPS with valid certificates
- [ ] Configure proper CORS policies
- [ ] Implement rate limiting
- [ ] Regular security audits

### Vault

- [ ] Automate Vault unsealing (use cloud auto-unseal)
- [ ] Backup unseal keys securely (split across team)
- [ ] Implement key rotation
- [ ] Monitor Vault health

### Database

- [ ] Set up regular backups
- [ ] Configure replication for high availability
- [ ] Tune PostgreSQL for production workload
- [ ] Monitor query performance

### Keycloak

- [ ] Configure email server for user registration
- [ ] Set up proper realm roles and permissions
- [ ] Enable MFA for admin accounts
- [ ] Configure session timeouts
- [ ] Set up user federation if needed (LDAP, AD)

### Monitoring

- [ ] Set up logging aggregation (ELK, Grafana)
- [ ] Configure health check monitoring
- [ ] Set up alerts for service failures
- [ ] Monitor resource usage

### Scalability

- [ ] Use external database (not in Docker)
- [ ] Configure Elasticsearch cluster
- [ ] Set up Kafka cluster for event streaming
- [ ] Implement load balancing
- [ ] Use container orchestration (Kubernetes)

---

## Additional Resources

- [Sunbird RC Documentation](https://docs.sunbirdrc.dev/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Vault Documentation](https://www.vaultproject.io/docs)
- [JSON Schema Specification](https://json-schema.org/)
- [Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)

---

## Support and Contribution

### This Fork
- **Repository**: https://github.com/dedenbangkit/sunbird-rc-core
- **Issues**: Report fork-specific issues here
- **Pull Requests**: Contributions welcome!

### Upstream (Original)
- **Repository**: https://github.com/Sunbird-RC/sunbird-rc-core
- **Issues**: Report upstream issues there
- **Community**: Join Sunbird RC discussions

### Contributing to This Fork
1. Fork this repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

**Document Version**: 1.2
**Last Updated**: 2026-01-09
**Tested With**: Sunbird RC v2.0.2

### Changelog
- **v1.2** (2026-01-09): Added WaterFacility schema with custom wfId generation, duplicate rejection, AOP-based entity data capture, and Jupyter notebook demo
- **v1.1** (2025-12-02): Added automated startup script, updated vault unsealing documentation, added known issues section
- **v1.0** (2025-11-27): Initial comprehensive setup guide
