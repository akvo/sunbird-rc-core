/**
 * API Configuration
 *
 * For local development:
 * - Add "127.0.0.1 keycloak" to /etc/hosts
 * - Token endpoint uses keycloak:8080 because registry validates
 *   token issuer against oauth2_resource_uri from .env
 */

// Detect environment
const isDevelopment = import.meta.env.DEV;

// API base URLs - use relative paths, Vite proxy handles routing in dev
export const API_CONFIG = {
  // Registry API base URL
  registryBaseUrl: '/registry',

  // Keycloak token endpoint
  // Local dev requires keycloak:8080 for token issuer validation
  // Vite proxy forwards /auth to keycloak:8080
  tokenEndpoint: '/auth/realms/sunbird-rc/protocol/openid-connect/token',

  // OAuth2 client credentials (should be in env vars for production)
  clientId: import.meta.env.VITE_OAUTH_CLIENT_ID || 'demo-api',
  clientSecret: import.meta.env.VITE_OAUTH_CLIENT_SECRET || '55ce6b67-8bd6-4fe3-b1a7-94132e6cfb72',

  // Token settings
  tokenExpiryBuffer: 30, // Refresh 30 seconds before expiry
  defaultTokenExpiry: 300, // Default 5 minutes if not in response

  // Search settings
  defaultLimit: 1000,
  maxLimit: 10000, // Elasticsearch limit

  // Entity names
  entities: {
    waterFacility: 'WaterFacility',
  },
};

// Search filter operators
export const FILTER_OPERATORS = {
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  CONTAINS: 'contains',
  OR: 'or',
};

// Available fields for filtering and display
export const WATER_FACILITY_FIELDS = {
  // Location
  countyName: 'countyName',
  districtName: 'districtName',
  communityName: 'communityName',
  latitude: 'latitude',
  longitude: 'longitude',

  // Infrastructure
  waterSource: 'waterSource',
  technologyType: 'technologyType',
  pumpType: 'pumpType',
  depthMetres: 'depthMetres',
  staticWaterLevel: 'staticWaterLevel',

  // Management
  managementType: 'managementType',
  installedBy: 'installedBy',
  constructionYear: 'constructionYear',
  registrationYear: 'registrationYear',

  // Status
  currentStatus: 'currentStatus',
};

export default API_CONFIG;
