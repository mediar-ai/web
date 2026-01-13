/**
 * Safely fetch JSON from an API endpoint with proper error handling.
 * Handles cases where the server returns HTML instead of JSON (e.g., 404 pages).
 */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);

  if (!res.ok) {
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const error = await res.json();
      throw new Error(error.error || `Request failed (${res.status})`);
    }
    throw new Error(`Request failed (${res.status})`);
  }

  return res.json();
}
