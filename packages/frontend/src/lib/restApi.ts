/**
 * A Home Assistant REST call with a long-lived token, for when Circuitry runs
 * outside HA's own frontend (HA's `hass.callApi` does this in a panel).
 *
 * A failure throws a RestApiError carrying the HTTP status as `status_code`
 * and the response body, as HA's own callApi does, so a 404 is told apart
 * from any other failure and HA's message (`{"message": ...}`, or the plain
 * text some errors send) reaches the user.
 */
export class RestApiError extends Error {
  readonly status_code: number;
  readonly body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`API error ${status}: ${messageOf(body) ?? statusText}`);
    this.name = 'RestApiError';
    this.status_code = status;
    this.body = body;
  }
}

function messageOf(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim() || undefined;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return undefined;
}

/** The body as JSON when it reads as JSON, else its text; null when empty. */
function bodyOf(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function restRequest<T = unknown>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  data?: unknown
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = bodyOf(await response.text());
  if (!response.ok) throw new RestApiError(response.status, response.statusText, body);
  // HA's JSON, typed by the caller as HA's own callApi is (an API boundary).
  return body as T;
}
