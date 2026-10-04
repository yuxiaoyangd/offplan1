import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env variables.");
}

const supabaseOrigin = new URL(supabaseUrl).origin;
const proxiedServicePath = /^\/(rest|auth|storage|functions)\/v1(?:\/|$)/;

const fetchWithSameOriginProxy: typeof fetch = (input, init) => {
  if (typeof window === "undefined") return fetch(input, init);

  let requestUrl: URL;
  try {
    requestUrl = new URL(input instanceof Request ? input.url : input.toString());
  } catch {
    return fetch(input, init);
  }

  if (requestUrl.origin !== supabaseOrigin || !proxiedServicePath.test(requestUrl.pathname)) {
    return fetch(input, init);
  }

  const proxyUrl = new URL(`/supabase${requestUrl.pathname}${requestUrl.search}`, window.location.origin);
  return fetch(input instanceof Request ? new Request(proxyUrl, input) : proxyUrl, init);
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fetchWithSameOriginProxy },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
