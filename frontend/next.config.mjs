/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
      // Returning a plain array here makes Next.js treat this as an
      // "afterFiles" rewrite — checked BEFORE dynamic app-router routes,
      // only after static files. That silently shadowed every dynamic
      // /api/* route handler in frontend/src/app/api/** (any using a
      // [param] or [...catchAll] segment, e.g. api/digest/[...path]):
      // requests to them never reached their route.ts at all, going
      // straight through to the bare backend instead with none of the
      // header injection (internal API key, etc.) that route.ts was
      // written to add — confirmed live 2026-08-25 via /api/digest/preview
      // 401ing with the backend's raw "missing x-internal-key" rejection,
      // no matter how the route.ts proxy file was edited or the dev server
      // restarted. `fallback` rewrites are checked only after BOTH static
      // AND dynamic filesystem routes have already had a chance to match,
      // which is the actual intent here: proxy anything with no route
      // handler of its own, never anything that has one.
      return {
        fallback: [
          {
            source: '/api/:path*',
            destination: 'http://127.0.0.1:3001/api/:path*', // <-- Changed from localhost
          },
        ],
      };
    },
  };
  
  export default nextConfig;