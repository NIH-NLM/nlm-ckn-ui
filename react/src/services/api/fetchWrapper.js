/**
 * Centralized fetch wrapper with consistent error handling.
 * Provides a unified approach to API calls across the application.
 */

/**
 * Custom error class for API errors with additional context.
 */
export class ApiError extends Error {
  constructor(message, status, endpoint) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * Wrapper around fetch with consistent error handling and logging.
 * @param {string} endpoint - The API endpoint URL.
 * @param {Object} [options={}] - Fetch options (method, headers, body, etc.).
 * @param {Object} [config={}] - Additional configuration.
 * @param {boolean} [config.silent=false] - If true, suppresses console.error logging.
 * @param {*} [config.fallback=null] - Value to return on error instead of throwing.
 * @returns {Promise<*>} Parsed JSON response or fallback value on error.
 * @throws {ApiError} When request fails and no fallback is provided.
 */
export const fetchWithErrorHandling = async (endpoint, options = {}, config = {}) => {
  const { silent = false, fallback = undefined } = config;

  // Set default headers for JSON requests
  const defaultHeaders = {
    "Content-Type": "application/json",
  };

  const mergedOptions = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(endpoint, mergedOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      const error = new ApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        endpoint,
      );

      if (!silent) {
        console.error(`API Error [${endpoint}]:`, {
          status: response.status,
          statusText: response.statusText,
          details: errorText,
        });
      }

      if (fallback !== undefined) {
        return fallback;
      }
      throw error;
    }

    return await response.json();
  } catch (error) {
    // Re-throw ApiError as-is
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle network errors or other fetch failures
    if (!silent) {
      console.error(`Network Error [${endpoint}]:`, error.message);
    }

    if (fallback !== undefined) {
      return fallback;
    }

    throw new ApiError(`Network error: ${error.message}`, 0, endpoint);
  }
};

/**
 * Convenience wrapper for POST requests with JSON body.
 * @param {string} endpoint - The API endpoint URL.
 * @param {Object} body - Request body to be JSON stringified.
 * @param {Object} [config={}] - Additional configuration (silent, fallback).
 * @returns {Promise<*>} Parsed JSON response.
 */
export const postJson = async (endpoint, body, config = {}) => {
  return fetchWithErrorHandling(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    config,
  );
};

/**
 * Convenience wrapper for GET requests.
 * @param {string} endpoint - The API endpoint URL.
 * @param {Object} [config={}] - Additional configuration (silent, fallback).
 * @returns {Promise<*>} Parsed JSON response.
 */
export const getJson = async (endpoint, config = {}) => {
  return fetchWithErrorHandling(endpoint, { method: "GET" }, config);
};
