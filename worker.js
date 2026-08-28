// ─── S&D Systems — Worker de entrada ───
// Antes de este archivo, el proyecto corría en modo "solo Static Assets"
// (sin ningún script de Worker), lo que dejaba a Cloudflare servir TODO
// -- incluido index.html -- directo desde su caché de borde, sin que el
// archivo _headers (Cache-Control: no-cache) tuviera efecto real sobre esa
// capa de caché (solo controla lo que el NAVEGADOR hace, no lo que
// Cloudflare guarda en sus PoP). Resultado: tras cada despliegue, los
// usuarios seguían viendo el index.html de la versión anterior hasta que,
// por azar, esa URL específica expiraba de la caché de borde.
//
// Con este Worker, index.html (y "/") pasan explícitamente por código
// antes de responder, forzando que Cloudflare NUNCA los sirva desde caché
// -- el resto de los archivos (JS, CSS, imágenes) se sirven igual que
// antes, directo desde Assets, conservando el cacheo normal (correcto:
// esos sí cambian de nombre via ?v= en cada despliegue, así que cachearlos
// agresivamente es deseable y no causa el problema).
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const esDocumentoPrincipal = url.pathname === '/' || url.pathname === '/index.html';

    if (!esDocumentoPrincipal) {
      return env.ASSETS.fetch(request);
    }

    // Pedir el asset siempre "fresco" -- cacheTtl:0 le dice a Cloudflare
    // que no debe servir ni guardar esta respuesta puntual en su caché de
    // borde.
    const resp = await env.ASSETS.fetch(request, { cf: { cacheTtl: 0, cacheEverything: false } });

    const headers = new Headers(resp.headers);
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');

    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  }
};
