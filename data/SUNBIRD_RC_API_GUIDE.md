# Sunbird RC API Guide for Dashboard Development

> Comprehensive reference for building visualizations with ECharts, Leaflet, and other frameworks using the Sunbird RC Registry API.

**Last Updated:** February 2026
**Registry:** Liberia Water Point Mapping 2017
**Total Records:** 19,210 water facilities

---

## Table of Contents

1. [API Overview](#1-api-overview)
2. [Authentication](#2-authentication)
3. [Data Structure](#3-data-structure)
4. [Search API & Filters](#4-search-api--filters)
5. [Performance Benchmarks](#5-performance-benchmarks)
6. [Known Limitations & Workarounds](#6-known-limitations--workarounds)
7. [Visualization Recommendations](#7-visualization-recommendations)
8. [Code Examples](#8-code-examples)
9. [Quick Reference](#9-quick-reference)

---

## 1. API Overview

### Base Configuration

```
Domain:       https://sunbird-rc.akvotest.org
API Base:     https://sunbird-rc.akvotest.org/api/v1
Entity:       WaterFacility
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/WaterFacility/search` | POST | Search with filters, pagination |
| `/api/v1/WaterFacility/{osid}` | GET | Get single facility by ID |
| `/api/v1/WaterFacility` | POST | Create new facility |
| `/api/v1/WaterFacility/{osid}` | PUT | Update facility |

### Search Request Format

```json
{
  "filters": {
    "field": {"operator": "value"}
  },
  "limit": 100,
  "offset": 0
}
```

### Search Response Format

```json
{
  "data": [...],
  "totalCount": 19210,
  "offset": 0
}
```

---

## 2. Authentication

### OAuth2 Client Credentials Flow

**Token Endpoint:**
```
POST https://sunbird-rc.akvotest.org/auth/realms/sunbird-rc/protocol/openid-connect/token
```

**Request Body (form-urlencoded):**
```
client_id=demo-api
client_secret=YOUR_SECRET
grant_type=client_credentials
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "expires_in": 300,
  "token_type": "Bearer"
}
```

### Token Management Best Practices

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| Token refresh buffer | 30 seconds | Refresh before actual expiry |
| Token cache | Yes | Avoid unnecessary auth calls |
| Retry on 401 | Up to 3 times | Handle token expiry during requests |

### JavaScript Token Manager Example

```javascript
class TokenManager {
  constructor(keycloakUrl, clientId, clientSecret) {
    this.keycloakUrl = keycloakUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshBuffer = 30; // seconds
  }

  async getToken() {
    if (this.isExpired()) {
      await this.refresh();
    }
    return this.accessToken;
  }

  isExpired() {
    return !this.accessToken || Date.now() / 1000 >= this.expiresAt;
  }

  async refresh() {
    const response = await fetch(this.keycloakUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials'
      })
    });
    const data = await response.json();
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() / 1000 + data.expires_in - this.refreshBuffer;
  }

  async getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await this.getToken()}`
    };
  }
}
```

---

## 3. Data Structure

### WaterFacility Entity Fields

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `osid` | string | `1-abc123-def456` | System ID (primary key) |
| `wfId` | string | `WF-NIM-SAN-PDW-473C97` | Human-readable facility ID |
| `geoCode` | string | `xvksf3s` | Unique geographic code |
| `waterPointType` | string | `Protected dug well` | See enum below |
| `location` | object | `{county, district, community, coordinates}` | Nested location data |
| `extractionType` | string | `Manual` | How water is extracted |
| `pumpType` | string | `India Mark` | Type of pump installed |
| `numTaps` | number | `2` | Number of taps |
| `hasDepthInfo` | boolean | `true` | **⚠️ Filter doesn't work** |
| `depthMetres` | number | `45.5` | Well depth in meters |
| `installer` | string | `Government` | Who installed |
| `owner` | string | `Community` | Current owner |
| `funder` | string | `UNICEF` | Funding organization |
| `photoUrl` | string | `https://...` | Photo URL |
| `osCreatedAt` | string | `2026-02-17T14:29:01.146Z` | Creation timestamp |
| `osUpdatedAt` | string | `2026-02-17T14:29:01.146Z` | Last update timestamp |

### Nested Location Object

```json
{
  "location": {
    "county": "Nimba",
    "district": "Sanniquellie Mahn",
    "community": "Kpaytuo Town",
    "coordinates": {
      "lat": 7.12345,
      "lon": -8.98765,
      "elevation": 325.4
    }
  }
}
```

### Water Point Type Enum

| Value | Count | % of Total |
|-------|-------|------------|
| Protected dug well | 10,663 | 55.5% |
| Unprotected dug well | 3,986 | 20.7% |
| Tube well or borehole | 1,788 | 9.3% |
| Protected spring | 1,062 | 5.5% |
| Unprotected spring | 579 | 3.0% |
| Piped water into dwelling/plot/yard | 432 | 2.2% |
| Public tap/standpipe | 262 | 1.4% |
| Other | 180 | 0.9% |
| Unequipped borehole | 118 | 0.6% |
| Rainwater (harvesting) | 84 | 0.4% |
| Sand/Sub-surface dam (with well or standpipe) | 56 | 0.3% |

### Extraction Type Enum

| Value | Count |
|-------|-------|
| Manual | 12,141 |
| Electrical | 508 |
| Other | 97 |
| Solar | 25 |

### Counties (Administrative Divisions)

| County | Facilities | % |
|--------|-----------|---|
| Montserrado | 5,917 | 30.8% |
| Nimba | 2,077 | 10.8% |
| Margibi | 1,596 | 8.3% |
| Lofa | 1,453 | 7.6% |
| Bong | 1,373 | 7.1% |
| Bomi | 1,275 | 6.6% |
| Grand Bassa | 1,151 | 6.0% |
| Grand Gedeh | 909 | 4.7% |
| Grand Cape Mount | 729 | 3.8% |
| Maryland | 635 | 3.3% |
| Sinoe | 621 | 3.2% |
| Gbarpolu | 466 | 2.4% |
| Grand Kru | 413 | 2.1% |
| River Cess | 362 | 1.9% |
| River Gee | 232 | 1.2% |

### Geographic Bounds (Liberia)

| Dimension | Min | Max |
|-----------|-----|-----|
| Latitude | 4.35° | 8.55° |
| Longitude | -11.50° | -7.37° |
| Elevation | 0m | ~800m |

---

## 4. Search API & Filters

### Filter Operators

| Operator | Syntax | Description | Performance |
|----------|--------|-------------|-------------|
| `eq` | `{"field": {"eq": "value"}}` | Exact match | ⚡ Fast |
| `neq` | `{"field": {"neq": "value"}}` | Not equal | ⚡ Fast |
| `gt` | `{"field": {"gt": 50}}` | Greater than | ⚡ Fast |
| `gte` | `{"field": {"gte": 50}}` | Greater than or equal | ⚡ Fast |
| `lt` | `{"field": {"lt": 100}}` | Less than | ⚡ Fast |
| `lte` | `{"field": {"lte": 100}}` | Less than or equal | ⚡ Fast |
| `contains` | `{"field": {"contains": "text"}}` | Text contains | 🐢 Slower |
| `or` | `{"field": {"or": ["a", "b"]}}` | Match any value | ⚡ Fast |

### Combining Filters (AND Logic)

Multiple filters in the same object are combined with AND:

```json
{
  "filters": {
    "location.county": {"eq": "Nimba"},
    "waterPointType": {"eq": "Tube well or borehole"},
    "installer": {"eq": "Government"}
  }
}
```

### Range Queries

Combine `gte` and `lte` for range:

```json
{
  "filters": {
    "location.coordinates.elevation": {"gte": 200, "lte": 400}
  }
}
```

### Nested Object Queries

Use dot notation for nested fields:

```json
{
  "filters": {
    "location.county": {"eq": "Nimba"},
    "location.coordinates.lat": {"gte": 6.0, "lte": 7.5}
  }
}
```

### Bounding Box Query (For Maps)

```json
{
  "filters": {
    "location.coordinates.lat": {"gte": 6.0, "lte": 7.5},
    "location.coordinates.lon": {"gte": -10.0, "lte": -8.5}
  }
}
```

### Filter Performance Comparison

| Filter Type | Avg Response Time | Throughput |
|-------------|-------------------|------------|
| No filter | 0.79s | ~500 rec/s |
| Single `eq` | 0.46s | ~500 rec/s |
| Single `contains` | 1.08s | ~350 rec/s |
| OR (3 values) | 0.82s | ~450 rec/s |
| Range | 0.57s | ~500 rec/s |
| Combined (2 filters) | 0.52s | ~500 rec/s |
| Combined (3 filters) | 0.43s | ~500 rec/s |
| Complex (4 filters) | 1.03s | ~400 rec/s |

---

## 5. Performance Benchmarks

### Query Size vs Response Time

| Records Requested | Response Time | Throughput |
|-------------------|---------------|------------|
| 10 | 0.42s | 24 rec/s |
| 50 | 0.44s | 113 rec/s |
| 100 | 0.87s | 115 rec/s |
| 500 | 1.49s | 336 rec/s |
| 1,000 | 2.18s | 459 rec/s |

### Bulk Fetch Performance

| Strategy | Records | Time | Throughput |
|----------|---------|------|------------|
| Single fetch (10K limit) | 10,000 | 19.0s | 526 rec/s |
| County partitioning | 19,209 | 48.3s | 398 rec/s |

### Recommendations by Use Case

| Use Case | Batch Size | Strategy |
|----------|------------|----------|
| Dashboard initial load | 100-500 | Single request |
| Table with pagination | 50-100 | Offset pagination |
| Full data export | 1,000 | County partitioning |
| Map visualization | 500-1,000 | Bounding box + pagination |
| Real-time filtering | 100 | Single request per filter |
| Chart aggregation | 1 (count only) | Use totalCount from response |

### Memory Considerations

| Records | Approx. Payload Size | Browser Memory |
|---------|---------------------|----------------|
| 100 | ~50 KB | Negligible |
| 1,000 | ~500 KB | Low |
| 5,000 | ~2.5 MB | Moderate |
| 10,000 | ~5 MB | Moderate |
| 19,210 | ~10 MB | Consider lazy loading |

---

## 6. Known Limitations & Workarounds

### ⚠️ Critical: Elasticsearch 10,000 Record Limit

**Problem:** Elasticsearch default `max_result_window` is 10,000. Requests with `offset >= 10000` will fail.

**Workaround:** Partition data by a categorical field (e.g., county):

```javascript
async function fetchAllData() {
  // First, get county list from a sample
  const sample = await searchFacilities({}, 5000);
  const counties = [...new Set(sample.data.map(d => d.location.county))];

  // Fetch each county separately (no county exceeds 10K)
  const allData = [];
  for (const county of counties) {
    const data = await fetchAllForCounty(county);
    allData.push(...data);
  }
  return allData;
}
```

### ⚠️ Boolean Filter Bug

**Problem:** `hasDepthInfo: {eq: true}` returns 0 results even though records exist with `hasDepthInfo: true`.

**Workaround:** Use numeric filter instead:
```json
// Instead of this (DOESN'T WORK):
{"hasDepthInfo": {"eq": true}}

// Use this (WORKS - returns 3,663 records):
{"depthMetres": {"gt": 0}}
```

### ⚠️ Fields Parameter Not Supported

**Problem:** The API ignores the `fields` parameter and always returns all 16 fields.

**Impact:** Cannot reduce payload size via field selection.

**Workaround:** Filter client-side after receiving data:
```javascript
const minimalData = response.data.map(d => ({
  lat: d.location?.coordinates?.lat,
  lon: d.location?.coordinates?.lon,
  type: d.waterPointType
}));
```

### ⚠️ No Aggregation Endpoint

**Problem:** No native COUNT BY or GROUP BY functionality.

**Workaround:** For counts by category, make separate requests:
```javascript
async function getCountByType(types) {
  const counts = {};
  for (const type of types) {
    const result = await searchFacilities({
      waterPointType: {eq: type}
    }, 1);
    counts[type] = result.totalCount;
  }
  return counts;
}
```

---

## 7. Visualization Recommendations

### ECharts Integration

#### Pie/Donut Chart (Water Point Types)

```javascript
// Fetch counts for each type
const typeCounts = await getCountByType(WATER_POINT_TYPES);

const option = {
  tooltip: { trigger: 'item' },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    data: Object.entries(typeCounts).map(([name, value]) => ({
      name,
      value
    }))
  }]
};
```

#### Bar Chart (By County)

```javascript
// API Strategy: Fetch sample and aggregate client-side
const sample = await fetchAllByCountyPartition();
const countyCounts = {};
sample.forEach(d => {
  const county = d.location?.county;
  countyCounts[county] = (countyCounts[county] || 0) + 1;
});

const option = {
  xAxis: { type: 'category', data: Object.keys(countyCounts) },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: Object.values(countyCounts) }]
};
```

#### Scatter Plot (Elevation vs Depth)

```javascript
// Fetch records with depth info
const data = await fetchAll({ depthMetres: { gt: 0 } });

const option = {
  xAxis: { name: 'Elevation (m)' },
  yAxis: { name: 'Depth (m)' },
  series: [{
    type: 'scatter',
    data: data.map(d => [
      d.location?.coordinates?.elevation,
      d.depthMetres
    ]).filter(([e, d]) => e && d)
  }]
};
```

### Leaflet Integration

#### Basic Marker Map

```javascript
// Fetch visible area data with bounding box
async function loadMarkersForBounds(bounds) {
  const result = await searchFacilities({
    'location.coordinates.lat': {
      gte: bounds.getSouth(),
      lte: bounds.getNorth()
    },
    'location.coordinates.lon': {
      gte: bounds.getWest(),
      lte: bounds.getEast()
    }
  }, 1000);

  return result.data;
}

// Add markers to map
function addMarkers(map, data) {
  const markers = L.markerClusterGroup();

  data.forEach(facility => {
    const { lat, lon } = facility.location?.coordinates || {};
    if (lat && lon) {
      const marker = L.marker([lat, lon])
        .bindPopup(`
          <b>${facility.wfId}</b><br>
          Type: ${facility.waterPointType}<br>
          Community: ${facility.location?.community}
        `);
      markers.addLayer(marker);
    }
  });

  map.addLayer(markers);
}
```

#### Choropleth by County

```javascript
// Pre-aggregate counts by county
const countyCounts = await getCountsByCounty();

// Color scale function
function getColor(count) {
  return count > 5000 ? '#800026' :
         count > 2000 ? '#BD0026' :
         count > 1000 ? '#E31A1C' :
         count > 500  ? '#FC4E2A' :
         count > 200  ? '#FD8D3C' :
         count > 100  ? '#FEB24C' :
                        '#FFEDA0';
}

// Style each county polygon
function style(feature) {
  return {
    fillColor: getColor(countyCounts[feature.properties.name] || 0),
    weight: 2,
    opacity: 1,
    color: 'white',
    fillOpacity: 0.7
  };
}
```

#### Heatmap Layer

```javascript
// Fetch all coordinates
const data = await fetchAllMinimal();
const heatData = data
  .filter(d => d.location?.coordinates)
  .map(d => [
    d.location.coordinates.lat,
    d.location.coordinates.lon,
    0.5 // intensity
  ]);

// Add heatmap layer
L.heatLayer(heatData, {
  radius: 15,
  blur: 20,
  maxZoom: 10,
  gradient: {
    0.4: 'blue',
    0.6: 'cyan',
    0.7: 'lime',
    0.8: 'yellow',
    1.0: 'red'
  }
}).addTo(map);
```

### Performance Optimization Strategies

#### 1. Progressive Loading

```javascript
// Load visible area first, then expand
async function progressiveLoad(map) {
  // 1. Load current viewport
  const bounds = map.getBounds();
  const visibleData = await loadMarkersForBounds(bounds);
  displayMarkers(visibleData);

  // 2. Background load remaining data
  const allData = await fetchAllByCountyPartition();
  cacheData(allData);
}
```

#### 2. Viewport-Based Loading

```javascript
map.on('moveend', debounce(async () => {
  const bounds = map.getBounds();
  const data = await loadMarkersForBounds(bounds);
  updateMarkers(data);
}, 300));
```

#### 3. Clustering for Large Datasets

```javascript
// Use marker clusters for 10K+ points
const markers = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true
});
```

#### 4. Server-Side Aggregation Pattern

Since API lacks aggregation, pre-compute and cache:

```javascript
// Cache structure for dashboard
const dashboardCache = {
  totalCount: 19210,
  byWaterPointType: { /* pre-computed */ },
  byCounty: { /* pre-computed */ },
  byExtractionType: { /* pre-computed */ },
  withDepthInfo: 3663,
  lastUpdated: '2026-02-18T00:00:00Z'
};
```

---

## 8. Code Examples

### Complete Fetch Helper (JavaScript)

```javascript
const API_BASE = 'https://sunbird-rc.akvotest.org/api/v1';

async function searchFacilities(filters = {}, limit = 100, offset = 0) {
  const response = await fetch(`${API_BASE}/WaterFacility/search`, {
    method: 'POST',
    headers: await tokenManager.getHeaders(),
    body: JSON.stringify({ filters, limit, offset })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

async function fetchAllWithPagination(filters = {}, batchSize = 500) {
  const allData = [];
  let offset = 0;
  let total = null;

  while (total === null || offset < Math.min(total, 10000)) {
    const result = await searchFacilities(filters, batchSize, offset);
    total = result.totalCount;
    allData.push(...result.data);
    offset += result.data.length;

    if (result.data.length < batchSize) break;
  }

  return { data: allData, totalCount: total };
}

async function fetchAllByCountyPartition(filters = {}) {
  // Get county list
  const sample = await searchFacilities({}, 5000);
  const counties = [...new Set(
    sample.data.map(d => d.location?.county).filter(Boolean)
  )];

  // Fetch each county
  const allData = [];
  for (const county of counties) {
    const countyFilters = {
      ...filters,
      'location.county': { eq: county }
    };
    const result = await fetchAllWithPagination(countyFilters);
    allData.push(...result.data);
  }

  return allData;
}
```

### React Hook Example

```javascript
import { useState, useEffect } from 'react';

function useWaterFacilities(filters, limit = 100) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        const result = await searchFacilities(filters, limit);
        if (!cancelled) {
          setData(result.data);
          setTotalCount(result.totalCount);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [JSON.stringify(filters), limit]);

  return { data, loading, error, totalCount };
}

// Usage
function WaterFacilityList() {
  const { data, loading, totalCount } = useWaterFacilities({
    'location.county': { eq: 'Nimba' }
  });

  if (loading) return <Spinner />;
  return (
    <div>
      <h2>Showing {data.length} of {totalCount} facilities</h2>
      {/* render data */}
    </div>
  );
}
```

### Python Example

```python
import requests
import time

class SunbirdRCClient:
    def __init__(self, domain, client_id, client_secret):
        self.base_url = f"{domain}/api/v1"
        self.token_url = f"{domain}/auth/realms/sunbird-rc/protocol/openid-connect/token"
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = None
        self.expires_at = 0

    def _refresh_token(self):
        response = requests.post(self.token_url, data={
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'grant_type': 'client_credentials'
        })
        data = response.json()
        self.access_token = data['access_token']
        self.expires_at = time.time() + data['expires_in'] - 30

    def _get_headers(self):
        if not self.access_token or time.time() >= self.expires_at:
            self._refresh_token()
        return {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.access_token}'
        }

    def search(self, filters=None, limit=100, offset=0):
        response = requests.post(
            f"{self.base_url}/WaterFacility/search",
            headers=self._get_headers(),
            json={'filters': filters or {}, 'limit': limit, 'offset': offset}
        )
        return response.json()

    def fetch_all(self, filters=None, batch_size=500):
        all_data = []
        offset = 0

        while True:
            result = self.search(filters, batch_size, offset)
            all_data.extend(result['data'])
            offset += len(result['data'])

            if len(result['data']) < batch_size or offset >= 10000:
                break

        return all_data
```

---

## 9. Quick Reference

### Common Filter Patterns

```javascript
// By county
{ "location.county": { "eq": "Nimba" } }

// Multiple counties
{ "location.county": { "or": ["Nimba", "Bong", "Lofa"] } }

// By water point type
{ "waterPointType": { "eq": "Tube well or borehole" } }

// Bounding box (for maps)
{
  "location.coordinates.lat": { "gte": 6.0, "lte": 7.5 },
  "location.coordinates.lon": { "gte": -10.0, "lte": -8.5 }
}

// Elevation range
{ "location.coordinates.elevation": { "gte": 200, "lte": 400 } }

// With depth data (use this, not hasDepthInfo)
{ "depthMetres": { "gt": 0 } }

// Community name search
{ "location.community": { "contains": "Town" } }

// Complex: Government boreholes in Nimba
{
  "location.county": { "eq": "Nimba" },
  "waterPointType": { "eq": "Tube well or borehole" },
  "installer": { "eq": "Government" }
}
```

### API Response Times (Expected)

| Operation | Expected Time |
|-----------|---------------|
| Single filter, 100 records | 0.4-0.9s |
| Complex filter, 100 records | 0.5-1.1s |
| Fetch 1,000 records | 2.0-2.5s |
| Fetch 10,000 records | 18-22s |
| Fetch all (19K via partitioning) | 45-55s |

### Key Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Max offset | 9,999 | ES `max_result_window` |
| Max per request | ~5,000 | Practical limit |
| Recommended batch | 500-1,000 | Balance speed/memory |
| Token lifetime | 300s | Refresh at 270s |

### Checklist for Dashboard Development

- [ ] Implement token auto-refresh
- [ ] Handle 10K pagination limit (use county partitioning)
- [ ] Use `depthMetres > 0` instead of `hasDepthInfo = true`
- [ ] Cache aggregation results (no server-side aggregation)
- [ ] Filter data client-side (fields param not supported)
- [ ] Use marker clustering for map with >1K points
- [ ] Implement viewport-based loading for maps
- [ ] Add loading states for API calls (0.4-2s response times)
- [ ] Handle token expiry (401) with retry logic

---

## Appendix: Data Statistics Summary

```
Total Facilities:        19,210
With Coordinates:        19,210 (100%)
With Depth Information:   3,663 (19.1%)

Top Water Point Types:
  - Protected dug well:     10,663 (55.5%)
  - Unprotected dug well:    3,986 (20.7%)
  - Tube well/borehole:      1,788 (9.3%)

Extraction Types:
  - Manual:      12,141 (63.2%)
  - Electrical:     508 (2.6%)
  - Solar:           25 (0.1%)
  - Other:           97 (0.5%)

Geographic Coverage:
  - 15 Counties
  - Lat range: ~4.35° to ~8.55°
  - Lon range: ~-11.5° to ~-7.4°
  - Elevation: 0 to ~800m
```
