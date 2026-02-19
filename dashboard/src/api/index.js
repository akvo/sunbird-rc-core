/**
 * API Module Exports
 *
 * Usage:
 *   import { searchWaterFacilities, tokenManager, aggregateByField } from './api';
 */

// Token management
export { tokenManager } from './tokenManager';

// Water facility API
export {
  searchWaterFacilities,
  fetchCountyData,
  fetchAllData,
  countFacilities,
  getFieldOptions,
  buildFilters,
  extractEssentialFields,
} from './waterFacility';

// Data aggregation utilities
export {
  countByField,
  toChartData,
  aggregateByField,
  calculateStats,
  crossTabulate,
  filterData,
  toPercentages,
  generateDashboardStats,
  aggregateByGeography,
} from './aggregation';

// Configuration
export { API_CONFIG, FILTER_OPERATORS, WATER_FACILITY_FIELDS } from '../config/api';

// Cache
export { getCachedData, setCachedData, clearCache, getCacheInfo } from './cache';
