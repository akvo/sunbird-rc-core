/**
 * React Hook for Water Facilities Data
 *
 * Provides easy-to-use interface for fetching and managing
 * water facility data in React components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAllData,
  searchWaterFacilities,
  generateDashboardStats,
  filterData,
  extractEssentialFields,
} from '../api';
import { getCachedData, setCachedData, clearCache, getCacheInfo } from '../api/cache';

/**
 * Hook for fetching and managing water facilities data
 * @param {Object} options - Hook options
 * @param {string[]} options.counties - List of counties to fetch
 * @param {boolean} options.autoFetch - Auto-fetch on mount (default: true)
 * @returns {Object} State and methods for water facilities
 */
export function useWaterFacilities({ counties = [], autoFetch = true } = {}) {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ county: '', index: 0, total: 0 });

  // Track if data has been fetched
  const hasFetched = useRef(false);

  // Filters state
  const [filters, setFilters] = useState({
    countyName: '',
    districtName: '',
    waterSource: '',
    technologyType: '',
    managementType: '',
    currentStatus: '',
  });

  /**
   * Fetch all water facilities data (with cache support)
   */
  const fetchData = useCallback(async (forceRefresh = false) => {
    if (counties.length === 0) {
      setError('No counties provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedData = await getCachedData();
        if (cachedData && cachedData.length > 0) {
          setData(cachedData);
          setFilteredData(cachedData);
          setStats(generateDashboardStats(cachedData));
          hasFetched.current = true;
          setLoading(false);
          console.debug('Using cached data');
          return;
        }
      }

      // Fetch from API
      setProgress({ county: 'Starting...', index: 0, total: counties.length });

      const allData = await fetchAllData(
        counties,
        {},
        (county, index, total) => {
          setProgress({ county, index, total });
        }
      );

      // Save only essential fields to cache (reduces storage size)
      const essentialData = allData.map(extractEssentialFields);
      await setCachedData(essentialData);

      // Use essential data for consistency with cache
      setData(essentialData);
      setFilteredData(essentialData);
      setStats(generateDashboardStats(essentialData));
      hasFetched.current = true;
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch water facilities:', err);
    } finally {
      setLoading(false);
      setProgress({ county: '', index: 0, total: 0 });
    }
  }, [counties]);

  /**
   * Search with specific filters (API call)
   */
  const search = useCallback(async (searchFilters) => {
    setLoading(true);
    setError(null);

    try {
      const results = await searchWaterFacilities({ filters: searchFilters });
      setFilteredData(results);
      setStats(generateDashboardStats(results));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Apply client-side filters to loaded data
   */
  const applyFilters = useCallback(
    (newFilters) => {
      setFilters(newFilters);

      // Filter data client-side
      const filtered = filterData(data, newFilters);
      setFilteredData(filtered);
      setStats(generateDashboardStats(filtered));
    },
    [data]
  );

  /**
   * Update a single filter
   */
  const updateFilter = useCallback(
    (field, value) => {
      const newFilters = { ...filters, [field]: value };

      // If county changes, reset district
      if (field === 'countyName') {
        newFilters.districtName = '';
      }

      applyFilters(newFilters);
    },
    [filters, applyFilters]
  );

  /**
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    const emptyFilters = {
      countyName: '',
      districtName: '',
      waterSource: '',
      technologyType: '',
      managementType: '',
      currentStatus: '',
    };
    setFilters(emptyFilters);
    setFilteredData(data);
    setStats(generateDashboardStats(data));
  }, [data]);

  /**
   * Refresh data from API (bypasses cache)
   */
  const refresh = useCallback(async () => {
    hasFetched.current = false;
    await clearCache();
    fetchData(true);
  }, [fetchData]);

  /**
   * Get cache information
   */
  const checkCache = useCallback(async () => {
    return getCacheInfo();
  }, []);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && counties.length > 0 && !hasFetched.current) {
      fetchData();
    }
  }, [autoFetch, counties, fetchData]);

  return {
    // Data
    data,
    filteredData,
    stats,

    // Loading state
    loading,
    error,
    progress,

    // Filters
    filters,
    updateFilter,
    applyFilters,
    clearFilters,

    // Actions
    fetchData,
    search,
    refresh,
    checkCache,
  };
}

export default useWaterFacilities;
