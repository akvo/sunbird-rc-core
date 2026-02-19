import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import { feature } from 'topojson-client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Droplets, Map, BarChart3, Filter } from 'lucide-react'
import './App.css'

const COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

function App() {
  const [loading, setLoading] = useState(true)
  const [administration, setAdministration] = useState(null)
  const [boundaries, setBoundaries] = useState(null)
  const [indicators, setIndicators] = useState(null)
  const [selectedCounty, setSelectedCounty] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('./data/liberia-administration.json').then(r => r.json()),
      fetch('./data/liberia-district-boundary.json').then(r => r.json()),
      fetch('./data/liberia-indicators.json').then(r => r.json()),
    ]).then(([admin, topo, ind]) => {
      setAdministration(admin)
      const geojson = feature(topo, topo.objects['liberia-district-boundary'])
      setBoundaries(geojson)
      setIndicators(ind)
      setLoading(false)
    }).catch(err => {
      console.error('Error loading data:', err)
      setLoading(false)
    })
  }, [])

  const counties = administration?.data.filter(d => d.level_id === 1) || []
  const districts = administration?.data.filter(d =>
    d.level_id === 2 && (!selectedCounty || d.parent_id === parseInt(selectedCounty))
  ) || []

  // Sample aggregated data for charts (placeholder - would come from actual data)
  const waterPointTypes = [
    { name: 'Borehole', value: 4520 },
    { name: 'Protected Well', value: 2340 },
    { name: 'Public Tap', value: 1890 },
    { name: 'Spring', value: 980 },
    { name: 'Other', value: 670 },
  ]

  const countyStats = counties.slice(0, 8).map((c, i) => ({
    name: c.name.length > 10 ? c.name.slice(0, 10) + '...' : c.name,
    waterPoints: Math.floor(Math.random() * 1000) + 200,
  }))

  const getDistrictStyle = (feature) => {
    const isSelected = selectedDistrict &&
      feature.properties.district === districts.find(d => d.id === parseInt(selectedDistrict))?.name
    const isCountySelected = selectedCounty &&
      feature.properties.county === counties.find(c => c.id === parseInt(selectedCounty))?.name

    return {
      fillColor: isSelected ? '#2563eb' : isCountySelected ? '#93c5fd' : '#cbd5e1',
      weight: isSelected ? 2 : 1,
      opacity: 1,
      color: isSelected ? '#1d4ed8' : '#64748b',
      fillOpacity: isSelected ? 0.7 : isCountySelected ? 0.5 : 0.3,
    }
  }

  const onEachDistrict = (feature, layer) => {
    layer.bindTooltip(`${feature.properties.district}, ${feature.properties.county}`)
    layer.on({
      click: () => {
        const county = counties.find(c => c.name === feature.properties.county)
        const district = administration.data.find(
          d => d.level_id === 2 && d.name === feature.properties.district && d.parent_id === county?.id
        )
        if (county) setSelectedCounty(String(county.id))
        if (district) setSelectedDistrict(String(district.id))
      }
    })
  }

  if (loading) {
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
          <Droplets size={28} />
          <h1>Liberia Water Point Dashboard</h1>
        </div>
        <p className="header-subtitle">Water Point Mapping Data Visualization</p>
      </header>

      <div className="filters">
        <div className="filter-group">
          <Filter size={18} />
          <span>Filters:</span>
        </div>
        <select
          value={selectedCounty}
          onChange={(e) => { setSelectedCounty(e.target.value); setSelectedDistrict(''); }}
        >
          <option value="">All Counties</option>
          {counties.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={selectedDistrict}
          onChange={(e) => setSelectedDistrict(e.target.value)}
          disabled={!selectedCounty}
        >
          <option value="">All Districts</option>
          {districts.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {(selectedCounty || selectedDistrict) && (
          <button className="clear-btn" onClick={() => { setSelectedCounty(''); setSelectedDistrict(''); }}>
            Clear
          </button>
        )}
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon blue"><Droplets size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">10,400</span>
            <span className="stat-label">Total Water Points</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><Map size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{counties.length}</span>
            <span className="stat-label">Counties</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><BarChart3 size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{districts.length}</span>
            <span className="stat-label">Districts</span>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="map-container">
          <h2><Map size={20} /> Map View</h2>
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
                key={`${selectedCounty}-${selectedDistrict}`}
              />
            )}
          </MapContainer>
        </div>

        <div className="charts-container">
          <div className="chart-card">
            <h3>Water Point Types</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={waterPointTypes}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {waterPointTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3>Water Points by County</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={countyStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="waterPoints" fill="#2563eb" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <footer className="footer">
        <p>Liberia Water Point Mapping Project &copy; 2024</p>
      </footer>
    </div>
  )
}

export default App
