#!/bin/bash

# Build script for custom registry with WaterFacility ID generation
# Run this after modifying Java files in java/registry/

set -e

echo "=========================================="
echo "Building Sunbird RC Registry"
echo "=========================================="

# Navigate to java directory
cd "$(dirname "$0")/java"

# Build the JAR
echo ""
echo "[1/3] Building JAR with Maven..."
./mvnw package -DskipTests -pl registry -am

# Check if build succeeded
if [ ! -f "registry/target/registry.jar" ]; then
    echo "❌ Build failed: registry.jar not found"
    exit 1
fi

echo "✓ JAR built successfully"

# Navigate back to root
cd ..

# Build Docker image
echo ""
echo "[2/3] Building Docker image..."
docker build -t sunbird-rc-core:local -f java/registry/Dockerfile java/registry

echo "✓ Docker image built: sunbird-rc-core:local"

# Ask if user wants to restart
echo ""
echo "[3/3] Restart registry service?"
echo "  1) Yes - restart registry only (fast)"
echo "  2) Yes - full restart with start-sunbird.sh"
echo "  3) No - just build"
echo ""
read -p "Choice [1/2/3]: " choice

case $choice in
    1)
        echo ""
        echo "Restarting registry service..."
        export IDGEN_ENABLED=true
        docker compose up -d registry
        echo ""
        echo "Waiting for registry to be healthy..."
        sleep 15
        if curl -s http://localhost:8081/health | grep -q '"healthy":true'; then
            echo "✓ Registry is healthy!"
        else
            echo "⚠ Registry may still be starting. Check with: docker compose logs -f registry"
        fi
        ;;
    2)
        echo ""
        echo "Running full restart with start-sunbird.sh..."
        docker compose down -t1
        ./start-sunbird.sh
        ;;
    3)
        echo ""
        echo "Build complete. To restart manually:"
        echo "  export IDGEN_ENABLED=true && docker compose up -d registry"
        echo "  OR"
        echo "  ./start-sunbird.sh"
        ;;
    *)
        echo "Invalid choice. Build complete, no restart."
        ;;
esac

echo ""
echo "=========================================="
echo "Done!"
echo "=========================================="
