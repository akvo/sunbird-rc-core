/**
 * Data Aggregation Utilities
 *
 * Since Sunbird RC doesn't support server-side aggregation,
 * these utilities perform client-side aggregation on fetched data.
 */

/**
 * Group records by a field and count
 * @param {Array} data - Array of records
 * @param {string} field - Field to group by
 * @returns {Object} Map of field value to count
 */
export function countByField(data, field) {
  return data.reduce((acc, record) => {
    const value = record[field] || 'Unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Convert count object to chart-ready array
 * @param {Object} counts - Map of value to count
 * @param {string} nameKey - Key for name in output
 * @param {string} valueKey - Key for value in output
 * @returns {Array} Array of {name, value} objects
 */
export function toChartData(counts, nameKey = 'name', valueKey = 'value') {
  return Object.entries(counts)
    .map(([name, value]) => ({ [nameKey]: name, [valueKey]: value }))
    .sort((a, b) => b[valueKey] - a[valueKey]);
}

/**
 * Group and aggregate data by field
 * @param {Array} data - Array of records
 * @param {string} groupField - Field to group by
 * @returns {Array} Chart-ready data sorted by count
 */
export function aggregateByField(data, groupField) {
  const counts = countByField(data, groupField);
  return toChartData(counts);
}

/**
 * Calculate statistics for a numeric field
 * @param {Array} data - Array of records
 * @param {string} field - Numeric field name
 * @returns {Object} Statistics {count, min, max, sum, avg}
 */
export function calculateStats(data, field) {
  const values = data
    .map((r) => parseFloat(r[field]))
    .filter((v) => !isNaN(v) && v !== null);

  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, sum: 0, avg: 0 };
  }

  const sum = values.reduce((a, b) => a + b, 0);

  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    sum,
    avg: sum / values.length,
  };
}

/**
 * Group by two fields (cross-tabulation)
 * @param {Array} data - Array of records
 * @param {string} field1 - First grouping field
 * @param {string} field2 - Second grouping field
 * @returns {Object} Nested map of field1 -> field2 -> count
 */
export function crossTabulate(data, field1, field2) {
  return data.reduce((acc, record) => {
    const val1 = record[field1] || 'Unknown';
    const val2 = record[field2] || 'Unknown';

    if (!acc[val1]) acc[val1] = {};
    acc[val1][val2] = (acc[val1][val2] || 0) + 1;

    return acc;
  }, {});
}

/**
 * Filter data by multiple conditions
 * @param {Array} data - Array of records
 * @param {Object} filters - Key-value pairs for filtering
 * @returns {Array} Filtered records
 */
export function filterData(data, filters) {
  return data.filter((record) => {
    for (const [field, value] of Object.entries(filters)) {
      if (value === null || value === undefined || value === '') continue;
      if (record[field] !== value) return false;
    }
    return true;
  });
}

/**
 * Calculate percentage distribution
 * @param {Object} counts - Map of value to count
 * @returns {Object} Map of value to percentage
 */
export function toPercentages(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return {};

  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [
      key,
      ((value / total) * 100).toFixed(1),
    ])
  );
}

/**
 * Generate summary statistics for dashboard
 * @param {Array} data - Array of water facility records
 * @returns {Object} Dashboard summary stats
 */
export function generateDashboardStats(data) {
  const statusCounts = countByField(data, 'currentStatus');
  const waterSourceCounts = countByField(data, 'waterSource');
  const technologyCounts = countByField(data, 'technologyType');
  const managementCounts = countByField(data, 'managementType');

  const depthStats = calculateStats(data, 'depthMetres');

  // Count facilities with coordinates
  const withCoordinates = data.filter(
    (r) => r.latitude && r.longitude && !isNaN(r.latitude) && !isNaN(r.longitude)
  ).length;

  return {
    totalFacilities: data.length,
    withCoordinates,
    byStatus: toChartData(statusCounts),
    byWaterSource: toChartData(waterSourceCounts),
    byTechnology: toChartData(technologyCounts),
    byManagement: toChartData(managementCounts),
    depthStatistics: depthStats,
    statusPercentages: toPercentages(statusCounts),
  };
}

/**
 * Aggregate data by geographic hierarchy
 * @param {Array} data - Array of records
 * @returns {Object} County -> District -> count hierarchy
 */
export function aggregateByGeography(data) {
  const hierarchy = {};

  for (const record of data) {
    const county = record.countyName || 'Unknown';
    const district = record.districtName || 'Unknown';

    if (!hierarchy[county]) {
      hierarchy[county] = { total: 0, districts: {} };
    }

    hierarchy[county].total++;

    if (!hierarchy[county].districts[district]) {
      hierarchy[county].districts[district] = 0;
    }
    hierarchy[county].districts[district]++;
  }

  return hierarchy;
}

export default {
  countByField,
  toChartData,
  aggregateByField,
  calculateStats,
  crossTabulate,
  filterData,
  toPercentages,
  generateDashboardStats,
  aggregateByGeography,
};
