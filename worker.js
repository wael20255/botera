export default {
  async fetch(request, env) {
    const assetRequest = new Request(request, { cache: "no-store" });
    const response = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(response.headers);

    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
