import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup } from 'react-leaflet'
import { feature } from 'topojson-client'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import { Droplets, Filter, AlertCircle, RefreshCw, MapPin, Map, ArrowDownCircle, Grid3X3, Circle } from 'lucide-react'
import { useWaterFacilities } from './hooks'
import { aggregateByGeography } from './api'
import { generateDotMatrixForRegions } from './dotMatrix'
import './App.css'

function App() {
  const [initialLoading, setInitialLoading] = useState(true)
  const [administration, setAdministration] = useState(null)
  const [boundaries, setBoundaries] = useState(null)
  const [selectedCounty, setSelectedCounty] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [showScrollHint, setShowScrollHint] = useState(true)
  const [colorMap, setColorMap] = useState({})
  const [mapMode, setMapMode] = useState('markers') // 'markers' or 'dotMatrix'
  const [dotMatrixIndicator, setDotMatrixIndicator] = useState('waterSource')
  const sidebarRef = useRef(null)

  // Handle sidebar scroll to show/hide scroll hint
  const handleSidebarScroll = useCallback(() => {
    if (sidebarRef.current) {
      const { scrollTop } = sidebarRef.current
      setShowScrollHint(scrollTop < 50)
    }
  }, [])

  // Get county names for API fetching
  const countyNames = useMemo(() => {
    if (!administration) return []
    return administration.data
      .filter(d => d.level_id === 1)
      .map(c => c.name)
  }, [administration])

  // Use real API data
  const {
    filteredData,
    stats,
    loading: apiLoading,
    error: apiError,
    progress,
    filters,
    updateFilter,
    clearFilters,
    refresh,
  } = useWaterFacilities({
    counties: countyNames,
    autoFetch: countyNames.length > 0,
  })

  // Load static data (boundaries, administration, indicators)
  useEffect(() => {
    Promise.all([
      fetch('./data/liberia-administration.json').then(r => r.json()),
      fetch('./data/liberia-district-boundary.json').then(r => r.json()),
      fetch('./data/liberia-indicators.json').then(r => r.json()),
    ]).then(([admin, topo, indicators]) => {
      setAdministration(admin)
      const geojson = feature(topo, topo.objects['liberia-district-boundary'])
      setBoundaries(geojson)
      // Build color lookup map from indicators
      const colors = {}
      indicators.colors?.forEach(({ color, options }) => {
        options.forEach(opt => {
          colors[opt.toLowerCase()] = color
        })
      })
      setColorMap(colors)
      setInitialLoading(false)
    }).catch(err => {
      console.error('Error loading data:', err)
      setInitialLoading(false)
    })
  }, [])

  // Helper to get color for an option name
  const getColor = (name, fallback = '#6b9ac4') => {
    if (!name) return fallback
    return colorMap[name.toLowerCase()] || fallback
  }

  const counties = administration?.data.filter(d => d.level_id === 1) || []
  const districts = administration?.data.filter(d =>
    d.level_id === 2 && (!selectedCounty || d.parent_id === parseInt(selectedCounty))
  ) || []

  // Sort with Other/Unknown at end (Other before Unknown)
  const sortWithUnknownLast = (data) => {
    const special = ['other', 'unknown', 'n/a', 'none', '']
    return data.sort((a, b) => {
      const aLower = a.name.toLowerCase()
      const bLower = b.name.toLowerCase()
      const aIsSpecial = special.includes(aLower)
      const bIsSpecial = special.includes(bLower)
      if (aIsSpecial && !bIsSpecial) return 1
      if (!aIsSpecial && bIsSpecial) return -1
      if (aIsSpecial && bIsSpecial) {
        // Both special: sort by position in special array (Other before Unknown)
        return special.indexOf(aLower) - special.indexOf(bLower)
      }
      return b.value - a.value
    })
  }

  // Aggregate data for charts
  const waterSourceData = useMemo(() => {
    if (!stats?.byWaterSource) return []
    return sortWithUnknownLast([...stats.byWaterSource]).slice(0, 8)
  }, [stats])

  const technologyData = useMemo(() => {
    if (!stats?.byTechnology) return []
    return sortWithUnknownLast([...stats.byTechnology]).slice(0, 8)
  }, [stats])

  const ownerData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return []
    const counts = {}
    filteredData.forEach(f => {
      const owner = f.owner || 'Unknown'
      counts[owner] = (counts[owner] || 0) + 1
    })
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }))
    return sortWithUnknownLast(data).slice(0, 8)
  }, [filteredData])

  const extractionData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return []
    const counts = {}
    filteredData.forEach(f => {
      const type = f.extractionType || 'Unknown'
      counts[type] = (counts[type] || 0) + 1
    })
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }))
    return sortWithUnknownLast(data).slice(0, 8)
  }, [filteredData])

  const districtData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return []
    const counts = {}
    filteredData.forEach(f => {
      const district = f.districtName || 'Unknown'
      counts[district] = (counts[district] || 0) + 1
    })
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }))
    return sortWithUnknownLast(data).slice(0, 10)
  }, [filteredData])

  // Dot matrix indicator options
  const dotMatrixIndicators = [
    { key: 'waterSource', label: 'Water Source Type' },
    { key: 'extractionType', label: 'Extraction Type' },
    { key: 'owner', label: 'Ownership' },
    { key: 'technologyType', label: 'Technology Type' },
  ]

  // Generate dot matrix data
  const dotMatrixData = useMemo(() => {
    if (mapMode !== 'dotMatrix' || !boundaries || !filteredData || filteredData.length === 0) {
      return []
    }
    return generateDotMatrixForRegions(
      boundaries,
      filteredData,
      dotMatrixIndicator,
      (name) => getColor(name, '#9CA3AF'),
      0.012
    )
  }, [mapMode, boundaries, filteredData, dotMatrixIndicator, colorMap])

  // Get unique categories for legend
  const dotMatrixLegend = useMemo(() => {
    if (mapMode !== 'dotMatrix' || !filteredData || filteredData.length === 0) return []
    const counts = {}
    filteredData.forEach(f => {
      const value = f[dotMatrixIndicator] || 'Unknown'
      counts[value] = (counts[value] || 0) + 1
    })
    return sortWithUnknownLast(
      Object.entries(counts).map(([name, value]) => ({
        name,
        value,
        color: getColor(name, '#9CA3AF')
      }))
    )
  }, [mapMode, filteredData, dotMatrixIndicator, colorMap])

  // Water points with coordinates for map markers
  const mapMarkers = useMemo(() => {
    if (!filteredData) return []
    return filteredData
      .filter(f => f.latitude && f.longitude && !isNaN(f.latitude) && !isNaN(f.longitude))
      .slice(0, 1000) // Limit markers for performance
  }, [filteredData])

  // Handle filter changes
  const handleCountyChange = (e) => {
    const countyId = e.target.value
    setSelectedCounty(countyId)
    setSelectedDistrict('')

    const countyName = counties.find(c => c.id === parseInt(countyId))?.name || ''
    updateFilter('countyName', countyName)
  }

  const handleDistrictChange = (e) => {
    const districtId = e.target.value
    setSelectedDistrict(districtId)

    const districtName = districts.find(d => d.id === parseInt(districtId))?.name || ''
    updateFilter('districtName', districtName)
  }

  const handleClearFilters = () => {
    setSelectedCounty('')
    setSelectedDistrict('')
    clearFilters()
  }

  const getDistrictStyle = (feature) => {
    const isSelected = selectedDistrict &&
      feature.properties.district === districts.find(d => d.id === parseInt(selectedDistrict))?.name
    const isCountySelected = selectedCounty &&
      feature.properties.county === counties.find(c => c.id === parseInt(selectedCounty))?.name

    // In dot matrix mode, use transparent fill
    if (mapMode === 'dotMatrix') {
      return {
        fillColor: 'transparent',
        weight: isSelected ? 2 : 1,
        opacity: 1,
        color: isSelected ? '#1d4ed8' : '#64748b',
        fillOpacity: 0,
      }
    }

    // Color by water point count if we have data
    let fillColor = '#cbd5e1'
    if (filteredData && filteredData.length > 0 && !isSelected && !isCountySelected) {
      const geo = aggregateByGeography(filteredData)
      const countyData = geo[feature.properties.county]
      if (countyData) {
        const districtCount = countyData.districts[feature.properties.district] || 0
        const maxCount = Math.max(...Object.values(countyData.districts))
        const intensity = maxCount > 0 ? districtCount / maxCount : 0
        fillColor = `rgba(37, 99, 235, ${0.2 + intensity * 0.6})`
      }
    }

    return {
      fillColor: isSelected ? '#2563eb' : isCountySelected ? '#93c5fd' : fillColor,
      weight: isSelected ? 2 : 1,
      opacity: 1,
      color: isSelected ? '#1d4ed8' : '#64748b',
      fillOpacity: isSelected ? 0.7 : isCountySelected ? 0.5 : 0.5,
    }
  }

  const onEachDistrict = (feature, layer) => {
    const geo = filteredData ? aggregateByGeography(filteredData) : {}
    const countyData = geo[feature.properties.county]
    const districtCount = countyData?.districts[feature.properties.district] || 0

    layer.bindTooltip(
      `${feature.properties.district}, ${feature.properties.county}<br/>Water Points: ${districtCount}`
    )
    layer.on({
      click: () => {
        const county = counties.find(c => c.name === feature.properties.county)
        const district = administration.data.find(
          d => d.level_id === 2 && d.name === feature.properties.district && d.parent_id === county?.id
        )
        if (county) {
          setSelectedCounty(String(county.id))
          updateFilter('countyName', county.name)
        }
        if (district) {
          setSelectedDistrict(String(district.id))
          updateFilter('districtName', district.name)
        }
      }
    })
  }

  if (initialLoading) {
    return (
      <div className="loading">
        <Droplets size={48} className="loading-icon" />
        <p>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="header">
        <div className="header-title">
          <Droplets size={24} />
          <h1>Liberia Water Point Dashboard</h1>
        </div>
      </header>

      <div className="filters">
        <div className="filter-group">
          <Filter size={18} />
          <span>Filters:</span>
        </div>
        <select
          value={selectedCounty}
          onChange={handleCountyChange}
        >
          <option value="">All Counties</option>
          {counties.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={selectedDistrict}
          onChange={handleDistrictChange}
          disabled={!selectedCounty}
        >
          <option value="">All Districts</option>
          {districts.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {(selectedCounty || selectedDistrict) && (
          <button className="clear-btn" onClick={handleClearFilters}>
            Clear
          </button>
        )}
        <button
          className="refresh-btn"
          onClick={refresh}
          disabled={apiLoading}
          title="Refresh data"
        >
          <RefreshCw size={16} className={apiLoading ? 'spinning' : ''} />
        </button>

        <div className="map-mode-toggle">
          <button
            className={`mode-btn ${mapMode === 'markers' ? 'active' : ''}`}
            onClick={() => setMapMode('markers')}
            title="Show water point markers"
          >
            <Circle size={14} />
            <span>Markers</span>
          </button>
          <button
            className={`mode-btn ${mapMode === 'dotMatrix' ? 'active' : ''}`}
            onClick={() => setMapMode('dotMatrix')}
            title="Show dot matrix visualization"
          >
            <Grid3X3 size={14} />
            <span>Dot Matrix</span>
          </button>
          {mapMode === 'dotMatrix' && (
            <select
              value={dotMatrixIndicator}
              onChange={(e) => setDotMatrixIndicator(e.target.value)}
              className="dot-matrix-select"
            >
              {dotMatrixIndicators.map(ind => (
                <option key={ind.key} value={ind.key}>{ind.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="stats-inline">
          <div className="stat-badge">
            <Droplets size={14} />
            <span className="num">{stats?.totalFacilities?.toLocaleString() || '—'}</span>
            <span className="label">points</span>
          </div>
          <div className="stat-badge">
            <MapPin size={14} />
            <span className="num">{stats?.withCoordinates?.toLocaleString() || '—'}</span>
            <span className="label">mapped</span>
          </div>
          <div className="stat-badge">
            <Map size={14} />
            <span className="num">{counties.length}</span>
            <span className="label">counties</span>
          </div>
        </div>
      </div>

      {/* API Loading/Error State */}
      {apiLoading && (
        <div className="api-status loading">
          <Droplets size={18} className="loading-icon" />
          <span>
            Loading data... {progress.county && `(${progress.county} - ${progress.index + 1}/${progress.total})`}
          </span>
        </div>
      )}

      {apiError && (
        <div className="api-status error">
          <AlertCircle size={18} />
          <span>Error loading data: {apiError}</span>
          <button onClick={refresh}>Retry</button>
        </div>
      )}

      <div className="main-content">
        <div className="map-container">
          <MapContainer
            center={[6.5, -9.5]}
            zoom={7}
            style={{ height: '100%', width: '100%', borderRadius: '8px' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {boundaries && (
              <GeoJSON
                data={boundaries}
                style={getDistrictStyle}
                onEachFeature={onEachDistrict}
                key={`${selectedCounty}-${selectedDistrict}-${filteredData?.length || 0}-${mapMode}`}
              />
            )}
            {mapMode === 'markers' && mapMarkers.map((facility, idx) => (
              <CircleMarker
                key={facility.osid || idx}
                center={[parseFloat(facility.latitude), parseFloat(facility.longitude)]}
                radius={2}
                fillColor="#2563eb"
                color="#1d4ed8"
                weight={1}
                opacity={0.8}
                fillOpacity={0.6}
              >
                <Popup>
                  <strong>{facility.communityName || 'Unknown'}</strong><br />
                  {facility.districtName}, {facility.countyName}<br />
                  Type: {facility.waterSource || 'N/A'}<br />
                  Technology: {facility.technologyType || 'N/A'}
                </Popup>
              </CircleMarker>
            ))}
            {mapMode === 'dotMatrix' && (
              <React.Fragment key={`dots-${dotMatrixIndicator}`}>
                {dotMatrixData.map((dot, idx) => (
                  <CircleMarker
                    key={idx}
                    center={[dot.coordinates[1], dot.coordinates[0]]}
                    radius={2}
                    fillColor={dot.color}
                    color={dot.color}
                    weight={0}
                    fillOpacity={1}
                  />
                ))}
              </React.Fragment>
            )}
          </MapContainer>
          {mapMode === 'dotMatrix' && dotMatrixLegend.length > 0 && (
            <div className="map-legend">
              <div className="legend-title">
                {dotMatrixIndicators.find(i => i.key === dotMatrixIndicator)?.label}
              </div>
              {dotMatrixLegend.slice(0, 8).map((item) => (
                <div key={item.name} className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: item.color }} />
                  <span className="legend-label">{item.name}</span>
                  <span className="legend-value">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar" ref={sidebarRef} onScroll={handleSidebarScroll}>
          <div className="chart-card">
            <h3>Water Source Types</h3>
            {waterSourceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={waterSourceData.length * 28 + 30}>
                <BarChart data={waterSourceData} layout="vertical" margin={{ left: 35, right: 5 }}>
                  <XAxis type="number" hide />
                  <YAxis yAxisId="left" dataKey="value" type="category" orientation="left" width={30}
                    tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" dataKey="name" type="category" orientation="right" width={140}
                    tick={{ fontSize: 10 }} tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '..' : v}
                    axisLine={false} tickLine={false} />
                  <Bar yAxisId="right" dataKey="value" radius={[3, 3, 3, 3]} barSize={18}>
                    {waterSourceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.name, '#6b9ac4')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">{apiLoading ? 'Loading...' : 'No data'}</div>
            )}
          </div>

          <div className="chart-card">
            <h3>Technology Type</h3>
            {technologyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={technologyData.length * 28 + 30}>
                <BarChart data={technologyData} layout="vertical" margin={{ left: 35, right: 5 }}>
                  <XAxis type="number" hide />
                  <YAxis yAxisId="left" dataKey="value" type="category" orientation="left" width={30}
                    tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" dataKey="name" type="category" orientation="right" width={140}
                    tick={{ fontSize: 10 }} tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '..' : v}
                    axisLine={false} tickLine={false} />
                  <Bar yAxisId="right" dataKey="value" radius={[3, 3, 3, 3]} barSize={18}>
                    {technologyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.name, '#7eb5a6')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">{apiLoading ? 'Loading...' : 'No data'}</div>
            )}
          </div>

          <div className="chart-card">
            <h3>Extraction Type</h3>
            {extractionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={extractionData.length * 28 + 30}>
                <BarChart data={extractionData} layout="vertical" margin={{ left: 35, right: 5 }}>
                  <XAxis type="number" hide />
                  <YAxis yAxisId="left" dataKey="value" type="category" orientation="left" width={30}
                    tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" dataKey="name" type="category" orientation="right" width={140}
                    tick={{ fontSize: 10 }} tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '..' : v}
                    axisLine={false} tickLine={false} />
                  <Bar yAxisId="right" dataKey="value" radius={[3, 3, 3, 3]} barSize={18}>
                    {extractionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.name, '#c4a76b')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">{apiLoading ? 'Loading...' : 'No data'}</div>
            )}
          </div>

          <div className="chart-card">
            <h3>Ownership</h3>
            {ownerData.length > 0 ? (
              <ResponsiveContainer width="100%" height={ownerData.length * 28 + 30}>
                <BarChart data={ownerData} layout="vertical" margin={{ left: 35, right: 5 }}>
                  <XAxis type="number" hide />
                  <YAxis yAxisId="left" dataKey="value" type="category" orientation="left" width={30}
                    tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" dataKey="name" type="category" orientation="right" width={140}
                    tick={{ fontSize: 10 }} tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '..' : v}
                    axisLine={false} tickLine={false} />
                  <Bar yAxisId="right" dataKey="value" radius={[3, 3, 3, 3]} barSize={18}>
                    {ownerData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.name, '#a67eb5')} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">{apiLoading ? 'Loading...' : 'No data'}</div>
            )}
          </div>

          <div className="chart-card">
            <h3>Top Districts</h3>
            {districtData.length > 0 ? (
              <ResponsiveContainer width="100%" height={districtData.length * 28 + 30}>
                <BarChart data={districtData} layout="vertical" margin={{ left: 35, right: 5 }}>
                  <XAxis type="number" hide />
                  <YAxis yAxisId="left" dataKey="value" type="category" orientation="left" width={30}
                    tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" dataKey="name" type="category" orientation="right" width={140}
                    tick={{ fontSize: 10 }} tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '..' : v}
                    axisLine={false} tickLine={false} />
                  <Bar yAxisId="right" dataKey="value" fill="#b5867e" radius={[3, 3, 3, 3]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-placeholder">{apiLoading ? 'Loading...' : 'No data'}</div>
            )}
          </div>

          {showScrollHint && (
            <div className="scroll-hint">
              <ArrowDownCircle size={32} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
