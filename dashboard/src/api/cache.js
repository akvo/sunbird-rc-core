/**
 * IndexedDB Cache using Dexie.js
 *
 * Caches water facility data locally for faster subsequent loads.
 * Default TTL is 1 hour.
 */

import Dexie from 'dexie';

// Create database
const db = new Dexie('WaterFacilityCache');

db.version(1).stores({
  facilities: 'osid, countyName, districtName',
  metadata: 'key',
});

// Default cache TTL: 1 hour
const DEFAULT_TTL = 60 * 60 * 1000;

/**
 * Get all cached facilities
 */
export async function getCachedData() {
  const meta = await db.metadata.get('lastFetch');

  if (!meta) return null;

  // Check if cache is expired
  const isExpired = Date.now() - meta.timestamp > (meta.ttl || DEFAULT_TTL);
  if (isExpired) {
    console.debug('Cache expired');
    return null;
  }

  const data = await db.facilities.toArray();
  console.debug(`Loaded ${data.length} facilities from cache`);
  return data;
}

/**
 * Save facilities to cache
 */
export async function setCachedData(data, ttl = DEFAULT_TTL) {
  // Clear existing data
  await db.facilities.clear();

  // Bulk insert new data
  await db.facilities.bulkPut(data);

  // Update metadata
  await db.metadata.put({
    key: 'lastFetch',
    timestamp: Date.now(),
    count: data.length,
    ttl,
  });

  console.debug(`Cached ${data.length} facilities`);
}

/**
 * Clear all cached data
 */
export async function clearCache() {
  await db.facilities.clear();
  await db.metadata.clear();
  console.debug('Cache cleared');
}

/**
 * Get cache info
 */
export async function getCacheInfo() {
  const meta = await db.metadata.get('lastFetch');
  if (!meta) return null;

  const isExpired = Date.now() - meta.timestamp > (meta.ttl || DEFAULT_TTL);

  return {
    lastFetch: new Date(meta.timestamp),
    count: meta.count,
    isExpired,
    expiresAt: new Date(meta.timestamp + (meta.ttl || DEFAULT_TTL)),
  };
}

export default { getCachedData, setCachedData, clearCache, getCacheInfo };
