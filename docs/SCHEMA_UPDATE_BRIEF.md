# WaterFacility Schema Update Brief

## Context

The WaterFacility schema needs to be simplified to act as a **DPI (Digital Public Infrastructure) registry** that connects multiple platforms (DHIS2, GIS systems, NGO platforms, etc.).

### Current Issues
1. `waterPointType` enum values are verbose and don't match DHIS2 Org Unit Group codes
2. No field to track which external platforms/APIs have data for this facility
3. Schema is too water-specific; should be more generic for future extensibility

---

## Required Changes

### 1. Update `WaterFacility.json` Schema

**File:** `java/registry/src/main/resources/public/_schemas/WaterFacility.json`

#### 1.1 Simplify `waterPointType` enum

**Current (lines 72-88):**
```json
"waterPointType": {
  "type": "string",
  "enum": [
    "Protected dug well",
    "Unprotected dug well",
    "Tube well or borehole",
    ...
  ]
}
```

**New:**
```json
"waterPointType": {
  "type": "string",
  "description": "Type of water point (matches DHIS2 Org Unit Group codes)",
  "enum": [
    "BOREHOLE",
    "HAND_PUMP",
    "PROTECTED_WELL",
    "UNPROTECTED_WELL",
    "PROTECTED_SPRING",
    "UNPROTECTED_SPRING",
    "PIPED_WATER",
    "RAINWATER_HARVESTING",
    "OTHER"
  ]
}
```

#### 1.2 Add `externalApis` field

Add new field to track external platform integrations:

```json
"externalApis": {
  "type": "array",
  "description": "External platforms that have data for this facility",
  "items": {
    "type": "object",
    "required": ["platform", "externalId"],
    "properties": {
      "platform": {
        "type": "string",
        "description": "Platform name (e.g., DHIS2, WaterAid, UNICEF)"
      },
      "externalId": {
        "type": "string",
        "description": "ID of this facility in the external platform"
      },
      "endpoint": {
        "type": "string",
        "format": "uri",
        "description": "API endpoint to fetch detailed data"
      },
      "capabilities": {
        "type": "array",
        "items": { "type": "string" },
        "description": "What data this platform provides (e.g., monitoring, maintenance, photos)"
      },
      "lastSync": {
        "type": "string",
        "format": "date-time",
        "description": "Last sync timestamp"
      }
    }
  }
}
```

#### 1.3 Update `_osConfig` indexFields

Add `externalApis.platform` and `externalApis.externalId` to indexed fields for search:

```json
"indexFields": [
  "wfId",
  "geoCode",
  "waterPointType",
  "location.county",
  "location.district",
  "externalApis.platform",
  "externalApis.externalId"
]
```

---

### 2. Update `WaterFacilityIdGenService.java`

**File:** `java/registry/src/main/java/dev/sunbirdrc/registry/service/impl/WaterFacilityIdGenService.java`

Update the `WATER_POINT_TYPE_CODES` mapping (lines 59-72):

**Current:**
```java
WATER_POINT_TYPE_CODES.put("Protected dug well", "PDW");
WATER_POINT_TYPE_CODES.put("Tube well or borehole", "TWB");
// ...
```

**New:**
```java
private static final Map<String, String> WATER_POINT_TYPE_CODES = new HashMap<>();
static {
    WATER_POINT_TYPE_CODES.put("BOREHOLE", "BH");
    WATER_POINT_TYPE_CODES.put("HAND_PUMP", "HP");
    WATER_POINT_TYPE_CODES.put("PROTECTED_WELL", "PW");
    WATER_POINT_TYPE_CODES.put("UNPROTECTED_WELL", "UW");
    WATER_POINT_TYPE_CODES.put("PROTECTED_SPRING", "PS");
    WATER_POINT_TYPE_CODES.put("UNPROTECTED_SPRING", "US");
    WATER_POINT_TYPE_CODES.put("PIPED_WATER", "PI");
    WATER_POINT_TYPE_CODES.put("RAINWATER_HARVESTING", "RW");
    WATER_POINT_TYPE_CODES.put("OTHER", "OT");
}
```

---

### 3. Update Jupyter Notebook Demo

**File:** `demo/jupyter-notebook/` (find relevant notebooks)

Update any example payloads to use the new enum values:

**Old:**
```json
{
  "WaterFacility": {
    "geoCode": "WF001",
    "waterPointType": "Tube well or borehole",
    "location": { ... }
  }
}
```

**New:**
```json
{
  "WaterFacility": {
    "geoCode": "WF001",
    "waterPointType": "BOREHOLE",
    "location": {
      "county": "Montserrado",
      "district": "Greater Monrovia",
      "community": "Paynesville"
    },
    "externalApis": [
      {
        "platform": "DHIS2",
        "externalId": "ou-abc123",
        "endpoint": "http://dhis2.example.com/api/organisationUnits/ou-abc123",
        "capabilities": ["monitoring", "water-quality"]
      }
    ]
  }
}
```

---

### 4. Update API Documentation (if exists)

Update any Swagger/OpenAPI docs to reflect:
- New enum values for `waterPointType`
- New `externalApis` field structure

---

## Mapping Reference: DHIS2 to Sunbird

| DHIS2 Org Unit Group | Sunbird waterPointType | wfId Code |
|---------------------|------------------------|-----------|
| `BOREHOLE` | `BOREHOLE` | `BH` |
| `HAND_PUMP` | `HAND_PUMP` | `HP` |
| `PROTECTED_WELL` | `PROTECTED_WELL` | `PW` |
| `UNPROTECTED_WELL` | `UNPROTECTED_WELL` | `UW` |
| `PROTECTED_SPRING` | `PROTECTED_SPRING` | `PS` |
| `UNPROTECTED_SPRING` | `UNPROTECTED_SPRING` | `US` |
| `PIPED_WATER` | `PIPED_WATER` | `PI` |
| `RAINWATER_HARVESTING` | `RAINWATER_HARVESTING` | `RW` |

---

## Example: Complete Sync Flow

```
1. DHIS2 creates facility org unit:
   - code: "LR_MONT_GM_PV_BH1"
   - group: BOREHOLE
   - parent hierarchy: Liberia > Montserrado > Greater Monrovia > Paynesville

2. DHIS2 syncs to Sunbird:
   POST /api/v1/WaterFacility
   {
     "geoCode": "LR_MONT_GM_PV_BH1",
     "waterPointType": "BOREHOLE",
     "location": {
       "county": "Montserrado",
       "district": "Greater Monrovia", 
       "community": "Paynesville",
       "coordinates": { "lat": 6.285, "lon": -10.765 }
     },
     "externalApis": [{
       "platform": "DHIS2",
       "externalId": "ou-abc123",
       "endpoint": "http://dhis2/api/organisationUnits/ou-abc123"
     }]
   }

3. Sunbird validates uniqueness (geoCode + location + coordinates)

4. Sunbird generates wfId: "WF-MON-GRE-BH-7A91C2"

5. Sunbird returns osid to DHIS2

6. DHIS2 stores osid in SUNBIRD_OSID attribute

7. Other platforms can later add their data:
   PATCH /api/v1/WaterFacility/{osid}
   {
     "externalApis": [{
       "platform": "WaterAid",
       "externalId": "wa-789",
       "capabilities": ["maintenance", "photos"]
     }]
   }
```

---

## Files to Modify Summary

| File | Change |
|------|--------|
| `java/registry/src/main/resources/public/_schemas/WaterFacility.json` | Update enum, add externalApis |
| `java/registry/src/main/java/dev/sunbirdrc/registry/service/impl/WaterFacilityIdGenService.java` | Update type codes mapping |
| `demo/jupyter-notebook/*.ipynb` | Update example payloads |
| API docs (if any) | Update documentation |

---

## After Changes

Rebuild Sunbird RC:
```bash
cd java
./mvnw clean install -DskipTests
docker-compose down && docker-compose up -d --build
```
