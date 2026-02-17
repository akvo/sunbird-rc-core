#!/bin/bash

# Enable ID generation for WaterFacility wfId
export IDGEN_ENABLED=true

# Enable signature and certificate for QR code generation
export SIGNATURE_ENABLED=true
export CERTIFICATE_ENABLED=true
# Use V1 signature provider (simpler, doesn't require DID/identity service)
export SIGNATURE_PROVIDER=dev.sunbirdrc.registry.service.impl.SignatureV1ServiceImpl

echo "Starting Sunbird RC..."
docker compose up -d

echo "Waiting for vault to be ready..."
sleep 10

echo "Unsealing vault..."
KEY1=$(sed -n 's/Unseal Key 1: \(.*\)/\1/p' keys.txt)
KEY2=$(sed -n 's/Unseal Key 2: \(.*\)/\1/p' keys.txt)
KEY3=$(sed -n 's/Unseal Key 3: \(.*\)/\1/p' keys.txt)
docker exec sunbird-rc-core-vault-1 vault operator unseal "$KEY1"
docker exec sunbird-rc-core-vault-1 vault operator unseal "$KEY2"
docker exec sunbird-rc-core-vault-1 vault operator unseal "$KEY3"

echo "Waiting for vault to become healthy..."
for i in {1..30}; do
  if docker ps | grep sunbird-rc-core-vault-1 | grep -q "(healthy)"; then
    echo "✓ Vault is healthy!"
    break
  fi
  echo -n "."
  sleep 2
done

echo "Starting dependent services..."
docker compose up -d claim-ms nginx metrics admin-portal

echo "Waiting for registry to be healthy..."
for i in {1..60}; do
  if curl -s http://localhost:8081/health | grep -q "healthy"; then
    echo "✓ Registry is healthy!"
    break
  fi
  echo -n "."
  sleep 2
done

echo "Waiting for services to stabilize..."
sleep 10

echo ""
echo "========================================"
echo "Sunbird RC is starting up!"
echo "========================================"
echo "Admin Portal: http://localhost:3001"
echo "Registry API: http://localhost:8081"
echo "Keycloak: http://localhost:8080"
echo "Nginx Gateway: http://localhost:80"
echo ""
echo "Note: Credential service may not start due to a known issue in v2.0.2"
echo "      Other services should work fine."
echo ""
docker compose ps
