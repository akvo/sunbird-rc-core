# Sunbird RC: Complete Authentication and Workflow Guide

A comprehensive guide to authentication mechanisms, entity identification (OSID), claims management, and the overall Sunbird RC workflow.

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Entity Identification (OSID)](#2-entity-identification-osid)
3. [Claims Management & Attestation](#3-claims-management--attestation)
4. [Overall Workflow](#4-overall-workflow)
5. [API Examples](#5-api-examples)
6. [Configuration & Deployment](#6-configuration--deployment)
7. [Best Practices](#7-best-practices)

---

## 1. Authentication & Authorization

### 1.1 Overview

Sunbird RC uses **Keycloak** as its Identity and Access Management (IAM) provider with **JWT (JSON Web Tokens)** for API authentication. The system supports:

- **Service Account Authentication** (client credentials flow) - for automated/admin operations
- **User Authentication** (password/authorization code flow) - for end-user access
- **Public Endpoints** - no authentication required

### 1.2 Keycloak Configuration

#### Realm Settings
```
Realm Name: sunbird-rc
Realm URL: http://keycloak:8080/auth/realms/sunbird-rc
Access Token Lifespan: 300 seconds (5 minutes)
SSO Session Idle Timeout: 1800 seconds (30 minutes)
Docker Image: ghcr.io/sunbird-rc/sunbird-rc-keycloak:latest
Database: PostgreSQL (shared with registry)
```

#### Keycloak Clients

**1. admin-api** - Service Account Client
```json
{
  "clientId": "admin-api",
  "authenticationType": "client-secret",
  "grantTypes": ["client_credentials"],
  "standardFlowEnabled": false,
  "directAccessGrantsEnabled": true,
  "purpose": "Administrative API access",
  "serviceAccount": "service-account-admin-api",
  "roles": ["admin"]
}
```

**2. registry-frontend** - Web UI Client
```json
{
  "clientId": "registry-frontend",
  "authenticationType": "client-secret",
  "grantTypes": ["authorization_code", "refresh_token"],
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "purpose": "Web UI authentication"
}
```

**3. admin-portal** - Admin Portal Client
```json
{
  "clientId": "admin-portal",
  "publicClient": true,
  "grantTypes": ["authorization_code", "implicit"],
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "redirectUris": ["http://localhost:3001/*", "http://localhost:3001"],
  "webOrigins": ["http://localhost:3001"]
}
```

### 1.3 Token Endpoints

#### Get Token via Client Credentials (Service Account)

**Endpoint**: `POST {KEYCLOAK_URL}/auth/realms/{REALM}/protocol/openid-connect/token`

**Request**:
```bash
curl -X POST http://localhost:8080/auth/realms/sunbird-rc/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-api" \
  -d "client_secret=<YOUR_CLIENT_SECRET>"
```

**Response**:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "refresh_expires_in": 0,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "scope": "profile email"
}
```

#### Get Token via Resource Owner Password Flow

**Request**:
```bash
curl -X POST http://localhost:8080/auth/realms/sunbird-rc/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=registry-frontend" \
  -d "username=<USERNAME>" \
  -d "password=<PASSWORD>"
```

### 1.4 JWT Token Structure

JWT tokens consist of 3 Base64-encoded parts: `{header}.{payload}.{signature}`

#### Token Claims (Payload)

```json
{
  "exp": 1634296970,
  "iat": 1634296670,
  "auth_time": 1634296670,
  "jti": "f2a4c9f8-5d3e-4bfa-a123-abc123def456",
  "iss": "http://keycloak:8080/auth/realms/sunbird-rc",
  "aud": "registry-frontend",
  "sub": "abc-def-123",
  "typ": "Bearer",
  "azp": "registry-frontend",
  "session_state": "xyz123",
  "name": "John Doe",
  "email": "john@example.com",
  "email_verified": true,
  "realm_access": {
    "roles": ["default-roles-sunbird-rc", "admin", "user"]
  },
  "resource_access": {
    "registry-frontend": {
      "roles": ["manage-users", "view-users"]
    }
  },
  "entity": ["Teacher", "School"],
  "consent": {}
}
```

#### Token Claims Configuration

**File**: `java/registry/src/main/resources/application.yml`

```yaml
oauth2:
  resources:
    - uri: ${oauth2_resource_uri:http://localhost:8080/auth/realms/sunbird-rc}
      properties:
        emailPath: ${oauth2_resource_email_path:email}
        consentPath: ${oauth2_resource_consent_path:consent}
        rolesPath: ${oauth2_resource_roles_path:realm_access.roles}
        entityPath: ${oauth2_resource_entity_path:entity}
        userIdPath: ${oauth2_resource_user_id_path:sub}
```

### 1.5 API Authentication

#### Adding Bearer Token to Requests

All API requests (except public endpoints) require JWT bearer token:

```http
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

#### Example: Create Schema with Authentication

```bash
# Step 1: Get token
TOKEN_RESPONSE=$(curl -X POST \
  http://localhost:8080/auth/realms/sunbird-rc/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-api" \
  -d "client_secret=<SECRET>")

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.access_token')

# Step 2: Use token in API request
curl -X POST http://localhost:8081/api/v1/Schema \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @schema.json
```

#### Public Endpoints (No Authentication)

These endpoints don't require authentication:

```
GET     /health                          - Health check
GET     /_schemas/**                     - Schema endpoints
GET     /**/templates/**                 - Template endpoints
GET     /**/*.json                       - JSON files
GET     /**/verify                       - Verification endpoints
GET     /swagger-ui                      - Swagger documentation
GET     /api/docs/swagger.json          - API documentation
GET     /plugin/**                       - Plugin endpoints
POST    /**/invite                       - Invite endpoints
GET     /**/search                       - Search endpoints
GET     /**/attestation/**               - Attestation endpoints
```

#### Protected Endpoints (Require Authentication)

All other endpoints require valid JWT token in Authorization header:

```
POST    /api/v1/{entity}                 - Create entity
GET     /api/v1/{entity}/{osid}          - Read entity
PUT     /api/v1/{entity}/{osid}          - Update entity
DELETE  /api/v1/{entity}/{osid}          - Delete entity
POST    /api/v1/{entity}/{osid}/attestation   - Request attestation
GET     /api/v1/claims/**                - Claims management
POST    /api/v1/Schema                   - Create schema
```

### 1.6 Default Credentials & Test Users

#### Admin Account (Keycloak)
```
Username: admin
Password: admin (changeable via KEYCLOAK_ADMIN_PASSWORD env var)
Access: Keycloak Admin Console at http://localhost:8080/auth/admin
Roles: realm-admin, manage-users, manage-clients
```

#### Service Account
```
Username: service-account-admin-api
Type: Service Account (uses client credentials, no password)
Associated Client: admin-api
Roles: admin
Used for: Automated administrative operations
```

#### Default User Password
```
Default Password: abcd@123
Configuration: sunbird_keycloak_user_password environment variable
Applied to: New users created via API
Temporary: Yes (requires change on first login)
```

#### Test API Request
```bash
# Using admin-api credentials
curl -X POST http://localhost:8080/auth/realms/sunbird-rc/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-api" \
  -d "client_secret=<KEYCLOAK_SECRET>"
```

### 1.7 Environment Variables for Authentication

```bash
# Keycloak Configuration
sunbird_sso_url=http://keycloak:8080/auth
sunbird_sso_realm=sunbird-rc
sunbird_sso_client_id=registry-frontend
sunbird_sso_admin_client_id=admin-api
sunbird_sso_admin_client_secret=<SECRET>

# Default Passwords
sunbird_keycloak_user_password=abcd@123
sunbird_keycloak_user_set_password=true

# Authentication Toggle
authentication_enabled=true

# OAuth2 Resource Configuration
OAUTH2_RESOURCES_0_URI=http://keycloak:8080/auth/realms/sunbird-rc
OAUTH2_RESOURCES_0_PROPERTIES_ROLES_PATH=realm_access.roles
oauth2_resource_uri=http://keycloak:8080/auth/realms/sunbird-rc

# JWT Validation (for NestJS services)
ENABLE_AUTH=false  # Set to true to enable JWT validation
JWKS_URI=http://keycloak:8080/auth/realms/sunbird-rc/protocol/openid-connect/certs
```

---

## 2. Entity Identification (OSID)

### 2.1 What is OSID?

**OSID** (OpenSearch ID) is the unique identifier for each entity and its nested properties in the Sunbird RC registry. It's auto-generated and serves as:

- Primary key for database records
- Reference for relationships between entities
- Audit trail identifier
- Ownership tracking mechanism

### 2.2 OSID Structure

OSID format follows the pattern: `{version}-{uuid}`

```
Example OSIDs:
1-b4907dc2-d3a8-49dc-a933-2b473bdd2ddb    (entity root OSID)
1-096cd663-6ba9-49f8-af31-1ace9e31bc31    (nested object OSID)
1-8d6dfb25-7789-44da-a6d4-eacf93e3a7bb    (nested property OSID)
```

### 2.3 Entity Structure with OSIDs

```json
{
  "Teacher": {
    "osid": "1-b4907dc2-d3a8-49dc-a933-2b473bdd2ddb",
    "name": "John Doe",
    "email": "john@example.com",
    "osOwner": "556302c9-d8b4-4f60-9ac1-c16c8839a9f3",
    
    "identityDetails": {
      "osid": "1-9f50f1b3-99cc-4fcb-9e51-e0dbe0be19f9",
      "gender": "Male",
      "identityType": "Aadhar"
    },
    
    "contactDetails": {
      "osid": "1-096cd663-6ba9-49f8-af31-1ace9e31bc31",
      "mobile": "9000090000",
      "email": "john@example.com"
    },
    
    "educationDetails": [
      {
        "osid": "1-8d6dfb25-7789-44da-a6d4-eacf93e3a7bb",
        "program": "Class 12",
        "institute": "ABC School",
        "graduationYear": "2021"
      }
    ]
  }
}
```

### 2.4 OSID Generation

OSIDs are auto-generated during entity creation through the **ID Generation Service**:

- **Service**: `id-gen-service`
- **Port**: 8088
- **Endpoint**: `POST /egov-idgen/id/_generate`

---

## 3. Claims Management & Attestation

### 3.1 Overview

**Claims** are requests for verification of entity data by authorized attestors. The claims workflow enables:

- Data verification by subject matter experts
- Multi-step approval processes
- Audit trails of approvals
- Certificate generation after attestation

### 3.2 Claim Status States

Claims flow through these states:

```
OPEN -> (attestor approves/rejects) -> CLOSED
```

#### Status Definitions

| Status | Description | Who Sets | Next States |
|--------|-------------|----------|------------|
| OPEN | Claim awaiting attestation | System (on entity update) | CLOSED |
| CLOSED | Claim processed (approved/rejected) | Attestor | None (final) |

### 3.3 Claims Service API

**Service**: Claims Microservice on port 8082

#### Endpoints

```
GET     /claims                          - List all claims
GET     /claims/{claimId}                - Get claim details
POST    /claims/{claimId}/attestation    - Attest a claim
GET     /claims/attestor/{entity}        - Claims for specific attestor
```

#### Get Claims for Attestor

```bash
curl -X GET "http://localhost:8082/claims/attestor/SchoolAdmin?page=0&size=10" \
  -H "Authorization: Bearer $TOKEN"
```

#### Process a Claim (Attestation)

```bash
curl -X POST http://localhost:8082/claims/claim-001/attestation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attestorInfo": {
      "osid": "1-abc123",
      "name": "Admin User",
      "entity": "SchoolAdmin"
    },
    "notes": "Verified qualifications against official records"
  }'
```

---

## 4. Overall Workflow

### 4.1 Complete Entity Lifecycle

```
Schema Definition
       |
       v
Authentication & Authorization (JWT token)
       |
       v
Entity Creation (OSID auto-generated)
       |
       v
Entity Modification (Update properties)
       |
       v
Attestation Policy Evaluation
       |
       v
Claim Generation (if attestation required)
       |
       v
Attestor Notification
       |
       v
Attestor Review & Approval
       |
       v
Claim Closure
       |
       v
Credential Generation (W3C VC)
       |
       v
Public Verification
```

---

## 5. API Examples

### 5.1 Complete User Journey Example

#### Step 1: Get Authentication Token

```bash
TOKEN=$(curl -X POST http://localhost:8080/auth/realms/sunbird-rc/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-api" \
  -d "client_secret=<SECRET>" | jq -r '.access_token')

echo "Token: $TOKEN"
```

#### Step 2: Create Entity

```bash
curl -X POST http://localhost:8081/api/v1/Teacher \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "Teacher": {
      "name": "John Doe",
      "email": "john@example.com",
      "qualifications": [
        {
          "degree": "B.Tech",
          "university": "IIT Delhi",
          "score": 8.5
        }
      ]
    }
  }'
```

**Response**:
```json
{
  "result": {
    "Teacher": {
      "osid": "1-b4907dc2-d3a8-49dc-a933-2b473bdd2ddb",
      "name": "John Doe",
      "email": "john@example.com"
    }
  },
  "params": {
    "status": "SUCCESSFUL"
  }
}
```

#### Step 3: Update Entity (Triggers Claim)

```bash
curl -X PUT http://localhost:8081/api/v1/Teacher/1-b4907dc2-d3a8-49dc-a933-2b473bdd2ddb \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "Teacher": {
      "qualifications": [
        {
          "degree": "M.Tech",
          "university": "IIT Delhi",
          "score": 9.0
        }
      ]
    }
  }'
```

#### Step 4: Get Claims for Attestor

```bash
curl -X GET "http://localhost:8082/claims/attestor/EducationBoard?page=0&size=10" \
  -H "Authorization: Bearer $TOKEN"
```

#### Step 5: Attest the Claim

```bash
curl -X POST http://localhost:8082/claims/claim-uuid-123/attestation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "attestor-user-id",
    "attestorInfo": {
      "osid": "1-attestor-osid",
      "name": "Education Board Reviewer",
      "entity": "EducationBoard"
    },
    "notes": "Degree verified from university records"
  }'
```

---

## 6. Configuration & Deployment

### 6.1 Environment Setup

Create `.env` file in project root:

```bash
# Keycloak
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=admin123
KEYCLOAK_SECRET=your-secret-here

# Database
POSTGRES_PASSWORD=postgres

# Release
RELEASE_VERSION=v2.0.2

# Features
AUTHENTICATION_ENABLED=false
CLAIMS_ENABLED=true
SIGNATURE_ENABLED=true
DID_ENABLED=true
```

### 6.2 Docker Compose Services

**Critical Services**:

```yaml
keycloak:          # Port 8080 - Identity Management
registry:          # Port 8081 - Core API
claim-ms:          # Port 8082 - Attestation Management
id-gen-service:    # Port 8088 - OSID Generation
db:                # Port 5432 - PostgreSQL Database
vault:             # Port 8200 - Secrets Management
```

### 6.3 Production Considerations

1. **Change Default Passwords** - All defaults must be changed
2. **Use HTTPS** - Enable SSL/TLS for all services
3. **Database Backup** - Regular PostgreSQL backups
4. **Role-Based Access** - Implement granular roles
5. **Audit Logging** - Enable comprehensive logging for compliance
6. **Rate Limiting** - Implement on public endpoints
7. **Monitoring** - Set up monitoring for all services

---

## 7. Best Practices

### 7.1 Authentication

1. **Never commit secrets** to version control - use environment variables
2. **Implement token caching** to reduce Keycloak load
3. **Handle token expiration** gracefully in client applications
4. **Use refresh tokens** for long-lived operations
5. **Validate tokens** at API boundaries

### 7.2 OSID Management

1. **Always use OSID** for entity references
2. **Never expose OSID** in public URLs if entity is private
3. **Track OSID changes** in audit logs
4. **Document OSID format** in API documentation

### 7.3 Claims Workflow

1. **Define clear attestation policies** before deployment
2. **Set appropriate attestor roles** for each entity type
3. **Implement timeout** for pending claims
4. **Notify attestors** of pending claims
5. **Audit all attestations** for compliance

### 7.4 Security

1. **Use HTTPS** in production
2. **Enable CORS** selectively for trusted domains
3. **Use strong passwords** for admin accounts
4. **Rotate secrets** periodically
5. **Enable MFA** for admin users
6. **Monitor access logs** for suspicious activity
7. **Encrypt sensitive data** at rest and in transit

---

## Summary

Sunbird RC provides a comprehensive framework for:

- **Authentication**: Keycloak-based OAuth2/OIDC with JWT tokens
- **Entity Management**: Auto-generated OSID for all entities
- **Data Verification**: Multi-step attestation workflow with claims tracking
- **Credential Generation**: W3C-compliant verifiable credentials
- **Audit & Compliance**: Complete audit trails and ownership tracking

This enables organizations to build secure, verifiable digital registries with minimal development effort.

---

**For more information**:
- Official Docs: https://docs.sunbirdrc.dev/
- GitHub: https://github.com/Sunbird-RC/sunbird-rc-core
- Community: https://github.com/Sunbird-RC/community/discussions
