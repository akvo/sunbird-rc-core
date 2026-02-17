#!/bin/bash
# Generate QR code for scanner app authentication
# Reads DEMO_API_CLIENT_SECRET from .env and generates a QR code

set -e

# Check if qr command exists first
if ! command -v qr &> /dev/null; then
    echo "Error: 'qr' command not found"
    echo ""
    echo "Please install qr first before running:"
    echo "  pip install qrcode[pil]"
    echo ""
    exit 1
fi

# Load .env file
if [ -f .env ]; then
    export $(grep -E '^DEMO_API_CLIENT_SECRET=' .env | xargs)
fi

if [ -z "$DEMO_API_CLIENT_SECRET" ]; then
    echo "Error: DEMO_API_CLIENT_SECRET not found in .env"
    exit 1
fi

# Create JSON payload with client credentials
PAYLOAD=$(cat <<EOF
{
  "client_id": "demo-api",
  "client_secret": "$DEMO_API_CLIENT_SECRET"
}
EOF
)

echo "Generating QR code for scanner authentication..."
echo ""

# Generate QR to terminal
echo "$PAYLOAD" | qr

# Also save as PNG if output file specified
if [ -n "$1" ]; then
    echo "$PAYLOAD" | qr > "$1"
    echo ""
    echo "QR code saved to: $1"
fi

echo ""
echo "Payload encoded in QR:"
echo "$PAYLOAD"
