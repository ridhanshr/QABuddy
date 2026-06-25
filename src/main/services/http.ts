import axios, { type AxiosInstance, type AxiosError } from "axios";
import type { AtlassianConnectionConfig } from "@shared/types";
import { normalizeUrl } from "./utils";

const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

function shouldRetry(error: AxiosError): boolean {
  if (!error.response) return true; // network error
  return RETRYABLE_STATUSES.includes(error.response.status);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupRetryInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as any;
    if (!config || !shouldRetry(error)) return Promise.reject(error);

    config.retryCount = (config.retryCount || 0) + 1;
    if (config.retryCount > MAX_RETRIES) return Promise.reject(error);

    const backoff = config.retryCount * 1000;
    await delay(backoff);
    return client(config);
  });
}

export function createAtlassianClient(
  config: AtlassianConnectionConfig,
  pathPrefix: string
): AxiosInstance {
  const baseUrl = normalizeUrl(config.baseUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (config.token) {
    if (config.authMode === "basic") {
      const payload = Buffer.from(`${config.username}:${config.token}`).toString("base64");
      headers.Authorization = `Basic ${payload}`;
    } else {
      headers.Authorization = `Bearer ${config.token}`;
    }
  }

  const client = axios.create({
    baseURL: `${baseUrl}${pathPrefix}`,
    headers,
    timeout: 60000,
    maxRedirects: 5,
  });

  setupRetryInterceptor(client);
  return client;
}
