# WaterFacility Schema Update for DHIS2 Integration

## Summary

This PR implements schema updates to transform WaterFacility into a DPI (Digital Public Infrastructure) registry that integrates with DHIS2 and other external platforms.

## Changes Made

### 1. Schema Updates (`WaterFacility.json`)

| Change | Before | After |
|--------|--------|-------|
| `waterPointType` enum | Verbose values (`"Protected dug well"`, `"Tube well or borehole"`) | DHIS2 codes (`"BOREHOLE"`, `"PROTECTED_WELL"`) |
| `geoCode` | Required field (manual input) | Auto-generated from coordinates (geohash) |
| `coordinates` | Optional | Required (`lat`, `lon`) |
| `externalApis` | Not present | New array field for external platform links |

**New `waterPointType` enum values:**
```
BOREHOLE, HAND_PUMP, PROTECTED_WELL, UNPROTECTED_WELL,
PROTECTED_SPRING, UNPROTECTED_SPRING, PIPED_WATER,
RAINWATER_HARVESTING, OTHER
```

**New `externalApis` structure:**
```json
{
  "platform": "DHIS2",
  "externalId": "ou-abc123",
  "endpoint": "http://dhis2.example.com/api/organisationUnits/ou-abc123",
  "capabilities": ["monitoring", "water-quality"],
  "lastSync": "2024-01-15T10:30:00Z"
}
```

### 2. ID Generation Service Updates (`WaterFacilityIdGenService.java`)

- **geoCode**: Now auto-generated as 8-character geohash (~19m precision) from `location.coordinates.lat` and `location.coordinates.lon`
- **wfId**: Format updated to use new type codes: `WF-<COUNTY>-<DISTRICT>-<TYPE>-<HASH>`

**Type code mapping:**
| waterPointType | wfId Code |
|----------------|-----------|
| BOREHOLE | BH |
| HAND_PUMP | HP |
| PROTECTED_WELL | PW |
| UNPROTECTED_WELL | UW |
| PROTECTED_SPRING | PS |
| UNPROTECTED_SPRING | US |
| PIPED_WATER | PI |
| RAINWATER_HARVESTING | RW |
| OTHER | OT |

### 3. Dashboard Updates (`liberia-indicators.json`)

- Updated color mappings to use new enum values

### 4. Jupyter Notebook Updates

- Updated example payloads to use new schema
- Removed `geoCode` from request payloads (now auto-generated)

---

## DevOps Deployment Instructions

### Pre-Deployment Checklist

- [ ] Backup production database
- [ ] Run data migration script (see below)
- [ ] Rebuild Docker image
- [ ] Plan maintenance window (schema changes require restart)

### Step 1: Backup Database

```bash
# On production server
docker exec -t sunbird-rc-core_db_1 pg_dump -U postgres registry > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Step 2: Run Data Migration (BEFORE deploying new code)

```sql
-- Migration script for existing WaterFacility records
-- Run this BEFORE deploying the new schema

-- 1. Map old waterPointType values to new enum values
UPDATE "V_WaterFacility" SET
  "waterPointType" = CASE "waterPointType"
    WHEN 'Protected dug well' THEN 'PROTECTED_WELL'
    WHEN 'Unprotected dug well' THEN 'UNPROTECTED_WELL'
    WHEN 'Tube well or borehole' THEN 'BOREHOLE'
    WHEN 'Protected spring' THEN 'PROTECTED_SPRING'
    WHEN 'Unprotected spring' THEN 'UNPROTECTED_SPRING'
    WHEN 'Rainwater collection' THEN 'RAINWATER_HARVESTING'
    WHEN 'Piped water into dwelling' THEN 'PIPED_WATER'
    WHEN 'Piped water to yard/plot' THEN 'PIPED_WATER'
    WHEN 'Public tap or standpipe' THEN 'PIPED_WATER'
    WHEN 'Cart with small tank' THEN 'OTHER'
    WHEN 'Tanker truck' THEN 'OTHER'
    WHEN 'Surface water' THEN 'OTHER'
    WHEN 'Bottled water' THEN 'OTHER'
    ELSE 'OTHER'
  END
WHERE "waterPointType" IS NOT NULL;

-- 2. Verify migration
SELECT "waterPointType", COUNT(*)
FROM "V_WaterFacility"
GROUP BY "waterPointType";
```

### Step 3: Rebuild and Deploy

```bash
# Pull latest code
git pull origin main

# Rebuild Docker image
docker build -t sunbird-rc-core:local -f java/registry/Dockerfile java/registry

# Restart services (use your start script)
./start-sunbird.sh

# Or manually:
# docker-compose down
# docker-compose up -d
```

### Step 4: Backfill geoCode for Existing Records

After deployment, existing records won't have auto-generated `geoCode`. Run this backfill:

```bash
# Option A: Use the API to update each record (triggers ID generation)
# This requires iterating through all records and PATCHing them

# Option B: Direct database update with geohash calculation
# (Requires a script - see backfill_geocode.py below)
```

**Python backfill script (`backfill_geocode.py`):**
```python
#!/usr/bin/env python3
"""
Backfill geoCode for existing WaterFacility records.
Run after schema migration.
"""
import psycopg2
import json

GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"

def generate_geohash(lat, lon, precision=8):
    min_lat, max_lat = -90.0, 90.0
    min_lon, max_lon = -180.0, 180.0
    geohash = []
    is_lon = True
    bit = 0
    ch = 0

    while len(geohash) < precision:
        if is_lon:
            mid = (min_lon + max_lon) / 2
            if lon >= mid:
                ch |= (1 << (4 - bit))
                min_lon = mid
            else:
                max_lon = mid
        else:
            mid = (min_lat + max_lat) / 2
            if lat >= mid:
                ch |= (1 << (4 - bit))
                min_lat = mid
            else:
                max_lat = mid

        is_lon = not is_lon
        bit += 1

        if bit == 5:
            geohash.append(GEOHASH_BASE32[ch])
            bit = 0
            ch = 0

    return ''.join(geohash)

def backfill():
    conn = psycopg2.connect(
        host="localhost",
        port=5432,
        database="registry",
        user="postgres",
        password="postgres"
    )
    cur = conn.cursor()

    # Find records without geoCode
    cur.execute("""
        SELECT osid, location
        FROM "V_WaterFacility"
        WHERE "geoCode" IS NULL OR "geoCode" = ''
    """)

    records = cur.fetchall()
    print(f"Found {len(records)} records to backfill")

    for osid, location in records:
        if location:
            loc = json.loads(location) if isinstance(location, str) else location
            coords = loc.get('coordinates', {})
            lat = coords.get('lat')
            lon = coords.get('lon')

            if lat is not None and lon is not None:
                geocode = generate_geohash(lat, lon)
                cur.execute(
                    'UPDATE "V_WaterFacility" SET "geoCode" = %s WHERE osid = %s',
                    (geocode, osid)
                )
                print(f"Updated {osid}: geoCode = {geocode}")

    conn.commit()
    cur.close()
    conn.close()
    print("Backfill complete")

if __name__ == "__main__":
    backfill()
```

### Step 5: Verify Deployment

```bash
# Check schema is updated
curl -s http://localhost:8081/api/docs/WaterFacility.json | jq '.definitions.WaterFacility.properties.waterPointType.enum'

# Expected output:
# ["BOREHOLE", "HAND_PUMP", "PROTECTED_WELL", ...]

# Check geoCode is in uniqueIdentifierFields
curl -s http://localhost:8081/api/docs/WaterFacility.json | jq '._osConfig.uniqueIdentifierFields'
```

---

## Production Data Considerations

### Breaking Changes

| Change | Impact | Mitigation |
|--------|--------|------------|
| `waterPointType` enum values changed | Existing records have old values | Run SQL migration BEFORE deployment |
| `geoCode` now required (but auto-generated) | Validation may fail for updates without coordinates | Ensure all records have valid coordinates |
| `wfId` format changed | New records will have different format than old | Old wfIds remain valid; only new records affected |

### Data Integrity Risks

1. **Duplicate Detection Changed**
   - The duplicate check uses the new `geoCode` (geohash) + location + type
   - Existing duplicates won't be detected retroactively
   - New submissions near existing points may be flagged as duplicates

2. **External API Integration**
   - The `externalApis` field is new and optional
   - Existing records will have `null` for this field
   - DHIS2 sync should populate this field going forward

3. **Coordinate Precision**
   - Geohash with 8 characters has ~19m precision
   - Two water points within 19m may generate the same geoCode
   - This is intentional for deduplication

### Rollback Plan

If issues occur:

```bash
# 1. Stop services
docker-compose down

# 2. Restore database from backup
docker-compose up -d db
cat backup_YYYYMMDD_HHMMSS.sql | docker exec -i sunbird-rc-core_db_1 psql -U postgres registry

# 3. Revert to previous Docker image
docker tag sunbird-rc-core:local sunbird-rc-core:broken
docker pull sunbird-rc-core:previous  # or rebuild from previous commit

# 4. Restart
docker-compose up -d
```

### Post-Migration Validation Queries

```sql
-- Check waterPointType distribution
SELECT "waterPointType", COUNT(*) as count
FROM "V_WaterFacility"
GROUP BY "waterPointType"
ORDER BY count DESC;

-- Check for records missing geoCode
SELECT COUNT(*) as missing_geocode
FROM "V_WaterFacility"
WHERE "geoCode" IS NULL OR "geoCode" = '';

-- Check for records missing coordinates
SELECT COUNT(*) as missing_coords
FROM "V_WaterFacility"
WHERE location->'coordinates'->'lat' IS NULL
   OR location->'coordinates'->'lon' IS NULL;

-- Verify geoCode format (should be 8 chars, alphanumeric)
SELECT osid, "geoCode"
FROM "V_WaterFacility"
WHERE LENGTH("geoCode") != 8
   OR "geoCode" !~ '^[0-9a-z]+$';
```

---

## Files Changed

| File | Change Type |
|------|-------------|
| `java/registry/src/main/resources/public/_schemas/WaterFacility.json` | Modified |
| `java/registry/src/main/java/dev/sunbirdrc/registry/service/impl/WaterFacilityIdGenService.java` | Modified |
| `dashboard/public/data/liberia-indicators.json` | Modified |
| `demo/jupyter-notebook/sunbird-rc-water-facility-demo.ipynb` | Modified |
| `demo/jupyter-notebook/sunbird-rc-water-facility-demo-public.ipynb` | Modified |

---

## Testing Checklist

- [ ] Create new WaterFacility with new enum values
- [ ] Verify geoCode is auto-generated from coordinates
- [ ] Verify wfId format is correct (e.g., `WF-MON-GRE-BH-A1B2C3`)
- [ ] Verify duplicate detection works
- [ ] Verify externalApis field can be added
- [ ] Test dashboard with new enum values
- [ ] Run Jupyter notebook demos successfully

---

## Related

- DHIS2 Integration Design Doc: [link if available]
- Schema Update Brief: `docs/SCHEMA_UPDATE_BRIEF.md`
