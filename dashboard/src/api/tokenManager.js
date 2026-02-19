/**
 * OAuth2 Token Manager
 *
 * Handles client credentials flow with automatic token refresh.
 * Token is refreshed 30 seconds before expiry to avoid request failures.
 */

import { API_CONFIG } from '../config/api';

class TokenManager {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.refreshPromise = null;
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} Access token
   */
  async getToken() {
    // If we have a valid token, return it
    if (this.isTokenValid()) {
      return this.token;
    }

    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Fetch a new token
    this.refreshPromise = this.fetchToken();

    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Check if current token is still valid
   * @returns {boolean}
   */
  isTokenValid() {
    if (!this.token || !this.tokenExpiry) {
      return false;
    }

    // Check if token expires within the buffer period
    const now = Date.now();
    const bufferMs = API_CONFIG.tokenExpiryBuffer * 1000;
    return this.tokenExpiry - now > bufferMs;
  }

  /**
   * Fetch a new token from Keycloak
   * @returns {Promise<string>} Access token
   */
  async fetchToken() {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: API_CONFIG.clientId,
      client_secret: API_CONFIG.clientSecret,
    });

    try {
      const response = await fetch(API_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token fetch failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Store token and calculate expiry
      this.token = data.access_token;
      const expiresIn = data.expires_in || API_CONFIG.defaultTokenExpiry;
      this.tokenExpiry = Date.now() + expiresIn * 1000;

      console.debug(
        `Token acquired, expires in ${expiresIn}s at ${new Date(this.tokenExpiry).toISOString()}`
      );

      return this.token;
    } catch (error) {
      console.error('Failed to fetch token:', error);
      throw error;
    }
  }

  /**
   * Clear the stored token (useful for logout or error recovery)
   */
  clearToken() {
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * Get authorization header for API requests
   * @returns {Promise<Object>} Headers object with Authorization
   */
  async getAuthHeaders() {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
export default tokenManager;
