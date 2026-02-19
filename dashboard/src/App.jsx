import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup } from 'react-leaflet'
import { feature } from 'topojson-client'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { Droplets, Filter, AlertCircle, RefreshCw, MapPin, Map, ArrowDownCircle } from 'lucide-react'
import { useWaterFacilities } from './hooks'
import { aggregateByGeography } from './api'
import './App.css'

function App() {
  const [initialLoading, setInitialLoading] = useState(true)
  const [administration, setAdministration] = useState(null)
  const [boundaries, setBoundaries] = useState(null)
  const [selectedCounty, setSelectedCounty] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [showScrollHint, setShowScrollHint] = useState(true)
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

  // Load static data (boundaries, administration)
  useEffect(() => {
    Promise.all([
      fetch('./data/liberia-administration.json').then(r => r.json()),
      fetch('./data/liberia-district-boundary.json').then(r => r.json()),
    ]).then(([admin, topo]) => {
      setAdministration(admin)
      const geojson = feature(topo, topo.objects['liberia-district-boundary'])
      setBoundaries(geojson)
      setInitialLoading(false)
    }).catch(err => {
      console.error('Error loading data:', err)
      setInitialLoading(false)
    })
  }, [])

  const counties = administration?.data.filter(d => d.level_id === 1) || []
  const districts = administration?.data.filter(d =>
    d.level_id === 2 && (!selectedCounty || d.parent_id === parseInt(selectedCounty))
  ) || []

  // Sort with Unknown/Other at end
  const sortWithUnknownLast = (data) => {
    const special = ['unknown', 'other', 'n/a', 'none', '']
    return data.sort((a, b) => {
      const aIsSpecial = special.includes(a.name.toLowerCase())
      const bIsSpecial = special.includes(b.name.toLowerCase())
      if (aIsSpecial && !bIsSpecial) return 1
      if (!aIsSpecial && bIsSpecial) return -1
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
                key={`${selectedCounty}-${selectedDistrict}-${filteredData?.length || 0}`}
              />
            )}
            {mapMarkers.map((facility, idx) => (
              <CircleMarker
                key={facility.osid || idx}
                center={[parseFloat(facility.latitude), parseFloat(facility.longitude)]}
                radius={4}
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
          </MapContainer>
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
                                    <Bar yAxisId="right" dataKey="value" fill="#6b9ac4" radius={[3, 3, 3, 3]} barSize={18} />
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
                                    <Bar yAxisId="right" dataKey="value" fill="#7eb5a6" radius={[3, 3, 3, 3]} barSize={18} />
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
                                    <Bar yAxisId="right" dataKey="value" fill="#c4a76b" radius={[3, 3, 3, 3]} barSize={18} />
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
                                    <Bar yAxisId="right" dataKey="value" fill="#a67eb5" radius={[3, 3, 3, 3]} barSize={18} />
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
