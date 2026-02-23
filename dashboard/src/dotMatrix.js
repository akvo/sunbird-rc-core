import * as turf from '@turf/turf'

/**
 * Generate dot matrix points within a polygon
 * @param {Object} feature - GeoJSON feature (polygon)
 * @param {Array} categories - Array of { name, value, color } objects
 * @param {number} cellSize - Size of hex grid cells in degrees (default 0.015)
 * @returns {Array} Array of dot objects with coordinates, category, and color
 */
export function generateDotMatrix(feature, categories, cellSize = 0.015) {
  try {
    if (!feature || !categories || categories.length === 0) {
      return []
    }

    const bbox = turf.bbox(feature)

    // Use hex grid for honeycomb pattern (no gaps, radial look)
    const hexGrid = turf.hexGrid(bbox, cellSize, { units: 'degrees' })

    // Get centroids of hex cells that intersect with polygon, with random jitter
    const jitterAmount = cellSize * 0.7
    const pointsInPolygon = []

    hexGrid.features.forEach((hex) => {
      try {
        const centroid = turf.centroid(hex)
        // Add random jitter to position
        const jitteredLng = centroid.geometry.coordinates[0] + (Math.random() - 0.5) * jitterAmount
        const jitteredLat = centroid.geometry.coordinates[1] + (Math.random() - 0.5) * jitterAmount
        const jitteredPoint = turf.point([jitteredLng, jitteredLat])

        if (turf.booleanPointInPolygon(jitteredPoint, feature)) {
          pointsInPolygon.push(jitteredPoint)
        } else if (turf.booleanPointInPolygon(centroid, feature)) {
          // Fallback to original centroid if jittered point is outside
          pointsInPolygon.push(centroid)
        }
      } catch {
        // Skip invalid geometries
      }
    })

    if (pointsInPolygon.length === 0) {
      return []
    }

    // Calculate proportions for each category
    const total = categories.reduce((sum, c) => sum + (c.value || 0), 0)
    if (total === 0) return []

    const categoryProportions = categories.map((c) => ({
      name: c.name,
      proportion: (c.value || 0) / total,
      color: c.color,
    }))

    // Shuffle points for random color distribution
    const shuffledIndices = pointsInPolygon.map((_, i) => i).sort(() => Math.random() - 0.5)

    const dots = []
    shuffledIndices.forEach((originalIndex, newIndex) => {
      const point = pointsInPolygon[originalIndex]
      const ratio = newIndex / pointsInPolygon.length
      let assignedCategory = categoryProportions[categoryProportions.length - 1]

      let cumulative = 0
      for (const category of categoryProportions) {
        cumulative += category.proportion
        if (ratio < cumulative) {
          assignedCategory = category
          break
        }
      }

      dots.push({
        coordinates: point.geometry.coordinates,
        category: assignedCategory.name,
        color: assignedCategory.color,
      })
    })

    return dots
  } catch (error) {
    console.error('Error generating dot matrix:', error)
    return []
  }
}

/**
 * Generate dot matrix for multiple regions based on facility data
 * @param {Object} geoJsonData - GeoJSON FeatureCollection with district boundaries
 * @param {Array} facilities - Array of facility objects
 * @param {string} groupByField - Field to group facilities by (e.g., 'waterSource', 'owner')
 * @param {Function} getColor - Function to get color for a category name
 * @param {number} cellSize - Size of hex grid cells
 * @returns {Array} Array of all dots across all regions
 */
export function generateDotMatrixForRegions(
  geoJsonData,
  facilities,
  groupByField,
  getColor,
  cellSize = 0.015
) {
  if (!geoJsonData || !facilities || facilities.length === 0) {
    return []
  }

  const allDots = []

  geoJsonData.features.forEach((feature) => {
    const districtName = feature.properties.district
    const countyName = feature.properties.county

    // Filter facilities for this district
    const districtFacilities = facilities.filter(
      (f) => f.districtName === districtName && f.countyName === countyName
    )

    if (districtFacilities.length === 0) return

    // Group facilities by the specified field
    const counts = {}
    districtFacilities.forEach((f) => {
      const value = f[groupByField] || 'Unknown'
      counts[value] = (counts[value] || 0) + 1
    })

    // Convert to categories array with colors
    const categories = Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: getColor(name),
    }))

    // Generate dots for this district
    const dots = generateDotMatrix(feature, categories, cellSize)
    dots.forEach((dot) => {
      allDots.push({
        ...dot,
        district: districtName,
        county: countyName,
      })
    })
  })

  return allDots
}
