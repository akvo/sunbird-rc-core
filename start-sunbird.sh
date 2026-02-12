#!/bin/bash

# Enable ID generation for WaterFacility wfId
export IDGEN_ENABLED=true

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
docker compose up -d identity credential-schema claim-ms nginx metrics admin-portal

echo "Waiting for services to be healthy..."
sleep 20

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
