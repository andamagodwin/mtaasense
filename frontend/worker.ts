/**
 * Worker entry: two jobs that have to happen before vinext sees the request, then vinext's own handler.
 *
 * - www.mtaasense.com → mtaasense.com, keeping path and query. (A next.config redirect can't do this:
 *   vinext passes external redirect destinations through untouched, dropping the query string.)
 * - Byte ranges for the hero reel. Workers static assets ignore `Range` and always send the whole file,
 *   and Safari will not play a <video> whose server does that.
 */
import vinext from "vinext/server/fetch-handler";

export * from "vinext/server/fetch-handler";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const worker = {
  ...vinext,
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === "www.mtaasense.com") {
      url.protocol = "https:";
      url.hostname = "mtaasense.com";
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname.startsWith("/hero/") && (request.method === "GET" || request.method === "HEAD")) {
      const asset = await env.ASSETS.fetch(new Request(url));
      if (asset.ok) return withRanges(request, asset);
    }
    return vinext.fetch(request, env, ctx);
  },
};

export default worker;

/** Serve an asset with `Accept-Ranges`, answering a single `bytes=` range with 206 (or 416 if unsatisfiable). */
async function withRanges(request: Request, asset: Response): Promise<Response> {
  const headers = new Headers(asset.headers);
  headers.set("accept-ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range || (!range[1] && !range[2])) {
    return new Response(request.method === "HEAD" ? null : asset.body, { status: 200, headers });
  }

  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  // "bytes=500-" and "bytes=500-999" count from the start; "bytes=-500" is the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    headers.set("content-range", `bytes */${size}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(request.method === "HEAD" ? null : body.slice(start, end + 1), { status: 206, headers });
}
