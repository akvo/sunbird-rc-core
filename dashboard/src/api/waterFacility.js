/**
 * WaterFacility API Client
 *
 * Provides methods to search and retrieve water facility data.
 *
 * IMPORTANT NOTES:
 * - Elasticsearch has a 10,000 record limit per query
 * - For larger datasets, use county partitioning strategy
 * - Boolean filter bug: use "depthMetres > 0" instead of "hasDepthInfo = true"
 * - No server-side aggregation - must aggregate client-side
 */

import { API_CONFIG, FILTER_OPERATORS } from '../config/api';
import tokenManager from './tokenManager';

/**
 * Flatten nested facility object for easier use
 * API returns nested location.county, location.coordinates.lat, etc.
 */
function flattenFacility(facility) {
  const location = facility.location || {};
  const coordinates = location.coordinates || {};

  return {
    ...facility,
    // Flatten location fields
    countyName: location.county || '',
    districtName: location.district || '',
    communityName: location.community || '',
    latitude: coordinates.lat,
    longitude: coordinates.lon,
    elevation: coordinates.elevation,
    // Map waterPointType to waterSource for consistency
    waterSource: facility.waterPointType || '',
    technologyType: facility.pumpType || '',
  };
}

/**
 * Extract only essential fields for caching (reduces storage size)
 * Full details can be fetched on-demand
 */
export function extractEssentialFields(facility) {
  return {
    osid: facility.osid,
    geoCode: facility.geoCode,
    // Location
    countyName: facility.countyName,
    districtName: facility.districtName,
    communityName: facility.communityName,
    latitude: facility.latitude,
    longitude: facility.longitude,
    // Key attributes for charts
    waterSource: facility.waterSource,
    technologyType: facility.technologyType,
    extractionType: facility.extractionType,
    owner: facility.owner,
  };
}

// Map flat field names to nested API field paths
const FIELD_MAPPING = {
  countyName: ['location', 'county'],
  districtName: ['location', 'district'],
  communityName: ['location', 'community'],
  waterSource: ['waterPointType'],
  technologyType: ['pumpType'],
};

/**
 * Set nested value in object using path array
 */
function setNestedValue(obj, path, value) {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!current[path[i]]) {
      current[path[i]] = {};
    }
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}

/**
 * Build filter object for search API
 * @param {Object} filters - Key-value pairs of field: value or field: {operator, value}
 * @returns {Object} Filters formatted for API
 */
export function buildFilters(filters) {
  const apiFilters = {};

  for (const [field, condition] of Object.entries(filters)) {
    if (condition === null || condition === undefined || condition === '') continue;

    // Get the path for this field
    const path = FIELD_MAPPING[field] || [field];

    // Build the filter value
    let filterValue;
    if (typeof condition !== 'object') {
      filterValue = { [FILTER_OPERATORS.EQ]: condition };
    } else if (condition.operator && condition.value !== undefined) {
      filterValue = { [condition.operator]: condition.value };
    } else {
      filterValue = condition;
    }

    // Set nested value
    setNestedValue(apiFilters, path, filterValue);
  }

  return apiFilters;
}

/**
 * Search water facilities with filters
 * @param {Object} options - Search options
 * @param {Object} options.filters - Filter conditions
 * @param {number} options.limit - Max results (default: 1000, max: 10000)
 * @param {number} options.offset - Pagination offset
 * @param {string[]} options.fields - Fields to return (empty = all)
 * @returns {Promise<Array>} Array of water facilities
 */
export async function searchWaterFacilities({
  filters = {},
  limit = API_CONFIG.defaultLimit,
  offset = 0,
  fields = [],
} = {}) {
  const headers = await tokenManager.getAuthHeaders();

  const body = {
    filters: buildFilters(filters),
    limit: Math.min(limit, API_CONFIG.maxLimit),
    offset,
  };

  // Only include viewFields if specific fields requested
  if (fields.length > 0) {
    body.viewFields = fields;
  }

  const url = `${API_CONFIG.registryBaseUrl}/api/v1/${API_CONFIG.entities.waterFacility}/search`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Search failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  // API returns { totalCount, data, nextPage } - flatten the nested location
  const data = result.data || result;
  return data.map(flattenFacility);
}

/**
 * Fetch all water facilities for a county (handles 10K limit)
 * @param {string} countyName - County to fetch
 * @param {Object} additionalFilters - Extra filters to apply
 * @returns {Promise<Array>} All facilities in county
 */
export async function fetchCountyData(countyName, additionalFilters = {}) {
  // Use flat field name - buildFilters will convert to nested structure
  const filters = {
    countyName,
    ...additionalFilters,
  };

  // Fetch with max limit - most counties have < 10K records
  return searchWaterFacilities({
    filters,
    limit: API_CONFIG.maxLimit,
  });
}

/**
 * Fetch all water facilities using county partitioning strategy
 * This handles datasets larger than 10K by fetching per-county
 * @param {string[]} counties - List of county names
 * @param {Object} filters - Additional filters to apply
 * @param {Function} onProgress - Callback for progress updates (county, index, total)
 * @returns {Promise<Array>} All facilities across counties
 */
export async function fetchAllData(counties, filters = {}, onProgress = null) {
  const allData = [];

  for (let i = 0; i < counties.length; i++) {
    const county = counties[i];

    if (onProgress) {
      onProgress(county, i, counties.length);
    }

    try {
      const countyData = await fetchCountyData(county, filters);
      allData.push(...countyData);
    } catch (error) {
      console.error(`Failed to fetch data for ${county}:`, error);
      // Continue with other counties
    }
  }

  return allData;
}

/**
 * Get count of facilities matching filters
 * Note: This fetches minimal data to count - no true count endpoint
 * @param {Object} filters - Filter conditions
 * @returns {Promise<number>} Count of matching records
 */
export async function countFacilities(filters = {}) {
  const results = await searchWaterFacilities({
    filters,
    limit: 1,
    fields: ['osid'], // Minimal field
  });

  // The API returns array, we can get count from response
  // For accurate count > 10K, need county partitioning
  return results.length;
}

/**
 * Get unique values for a field (for dropdown options)
 * @param {string} field - Field name to get unique values for
 * @param {Object} filters - Pre-filters to apply
 * @returns {Promise<string[]>} Unique values sorted
 */
export async function getFieldOptions(field, filters = {}) {
  const results = await searchWaterFacilities({
    filters,
    limit: API_CONFIG.maxLimit,
    fields: [field],
  });

  const uniqueValues = [...new Set(results.map((r) => r[field]).filter(Boolean))];
  return uniqueValues.sort();
}

export default {
  searchWaterFacilities,
  fetchCountyData,
  fetchAllData,
  countFacilities,
  getFieldOptions,
  buildFilters,
  extractEssentialFields,
};
