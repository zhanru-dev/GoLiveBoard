import { SafeHttpError, type SafeHttpClient } from "../net/safe-http.js";

export interface ProbeResult {
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly failure: string | null;
}

/** Every HLS playlist starts with this tag (RFC 8216 section 4.3.1.1). */
const HLS_SIGNATURE = "#EXTM3U";

/**
 * Fetches a manifest and decides whether the stream is reachable: a `2xx`
 * response whose body is an HLS playlist. A login page or an error page
 * served with `200` is a failure, because attendees could not play it.
 */
export async function probeStream(
  client: SafeHttpClient,
  url: string,
): Promise<ProbeResult> {
  try {
    const response = await client.get(url);
    if (response.status < 200 || response.status > 299) {
      return {
        ok: false,
        httpStatus: response.status,
        failure: `HTTP ${String(response.status)}`,
      };
    }
    if (!response.body.trimStart().startsWith(HLS_SIGNATURE)) {
      return {
        ok: false,
        httpStatus: response.status,
        failure: "The response is not an HLS playlist",
      };
    }
    return { ok: true, httpStatus: response.status, failure: null };
  } catch (error) {
    if (error instanceof SafeHttpError) {
      return { ok: false, httpStatus: null, failure: error.message };
    }
    throw error;
  }
}
