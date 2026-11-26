const http = require("node:http");
const path = require("node:path");
const { readFile } = require("node:fs/promises");

const TMDB_BASE_URL = "https://api.themoviedb.org";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w185";
const MAX_RESULTS = 12;
const MAX_QUERY_LENGTH = 100;
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://image.tmdb.org https://www.themoviedb.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
}

async function fetchTmdb(endpoint, params, apiToken, fetchImpl) {
  if (!apiToken) {
    throw new HttpError(503, "Configura TMDB_API_READ_ACCESS_TOKEN en el archivo .env para habilitar las consultas.");
  }

  const url = new URL(endpoint, TMDB_BASE_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  let upstream;
  try {
    upstream = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new HttpError(502, "No fue posible conectar con TMDb. Intenta de nuevo.");
  }

  if (upstream.status === 401 || upstream.status === 403) {
    throw new HttpError(502, "TMDb rechazó el token. Revisa TMDB_API_READ_ACCESS_TOKEN.");
  }
  if (upstream.status === 429) {
    throw new HttpError(503, "Se alcanzó el límite temporal de consultas de TMDb. Intenta más tarde.");
  }
  if (!upstream.ok) {
    throw new HttpError(502, "TMDb no pudo completar la consulta.");
  }

  try {
    const body = await upstream.json();
    if (!body || typeof body !== "object") {
      throw new HttpError(502, "TMDb devolvió una respuesta inválida.");
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "TMDb devolvió una respuesta que no se pudo interpretar.");
  }
}

function normalizeSearchResult(result, requestedType) {
  if (!result || typeof result !== "object") return null;
  const mediaType = result.media_type || requestedType;
  if (mediaType !== "movie" && mediaType !== "tv") return null;

  const title = mediaType === "movie" ? result.title : result.name;
  if (!Number.isSafeInteger(result.id) || !title) return null;

  const releaseDate = mediaType === "movie" ? result.release_date : result.first_air_date;
  const originalTitle = mediaType === "movie" ? result.original_title : result.original_name;

  return {
    id: result.id,
    mediaType,
    title,
    originalTitle: originalTitle || "",
    year: typeof releaseDate === "string" ? releaseDate.slice(0, 4) : "",
    overview: typeof result.overview === "string" ? result.overview : "",
    posterUrl: typeof result.poster_path === "string" && result.poster_path.startsWith("/")
      ? `${IMAGE_BASE_URL}${result.poster_path}`
      : null
  };
}

function normalizeSourceUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.themoviedb.org" ? url.href : null;
  } catch (error) {
    return null;
  }
}

function normalizeProviders(country) {
  if (!country || typeof country !== "object") return [];
  const categories = [
    ["subscription", "flatrate"],
    ["rent", "rent"],
    ["buy", "buy"],
    ["free", "free"],
    ["ads", "ads"]
  ];
  const offers = [];
  const seen = new Set();

  categories.forEach(([type, key]) => {
    const providers = Array.isArray(country[key]) ? country[key] : [];
    providers.forEach((provider) => {
      if (!provider || typeof provider !== "object" ||
          !Number.isSafeInteger(provider.provider_id) || typeof provider.provider_name !== "string") return;
      const uniqueKey = `${type}:${provider.provider_id}`;
      if (seen.has(uniqueKey)) return;
      seen.add(uniqueKey);
      offers.push({
        type,
        providerId: provider.provider_id,
        providerName: provider.provider_name,
        logoUrl: typeof provider.logo_path === "string" && provider.logo_path.startsWith("/")
          ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
          : null
      });
    });
  });

  return offers;
}

function createAppServer({ apiToken = process.env.TMDB_API_READ_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  return http.createServer((request, response) => {
    setSecurityHeaders(response);

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "Este endpoint solo acepta solicitudes GET." });
      return;
    }

    void routeRequest(request, response, apiToken, fetchImpl).catch((error) => {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("Error interno al atender la solicitud.", error);
      sendJson(response, 500, { error: "Ocurrió un error interno. Intenta de nuevo." });
    });
  });
}

async function routeRequest(request, response, apiToken, fetchImpl) {
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch (error) {
    sendJson(response, 400, { error: "La solicitud no tiene una URL válida." });
    return;
  }

  if (url.pathname === "/api/search") {
    const query = (url.searchParams.get("q") || "").trim();
    const type = url.searchParams.get("type") || "all";
    if (!query) {
      sendJson(response, 400, { error: "Escribe el nombre de una película o serie." });
      return;
    }
    if (query.length > MAX_QUERY_LENGTH) {
      sendJson(response, 400, { error: `La búsqueda no puede superar ${MAX_QUERY_LENGTH} caracteres.` });
      return;
    }
    if (!["all", "movie", "tv"].includes(type)) {
      sendJson(response, 400, { error: "El tipo de búsqueda debe ser all, movie o tv." });
      return;
    }

    const endpoint = type === "all" ? "/3/search/multi" : `/3/search/${type}`;
    const params = {
      query,
      language: "es-MX",
      include_adult: "false"
    };
    const result = await fetchTmdb(endpoint, params, apiToken, fetchImpl);
    if (!Array.isArray(result.results)) {
      throw new HttpError(502, "TMDb devolvió una respuesta de búsqueda inválida.");
    }
    const results = result.results
      .map((item) => normalizeSearchResult(item, type))
      .filter(Boolean)
      .slice(0, MAX_RESULTS);
    sendJson(response, 200, { results });
    return;
  }

  if (url.pathname === "/api/providers") {
    const type = url.searchParams.get("type");
    const id = Number(url.searchParams.get("id"));
    if (!["movie", "tv"].includes(type) || !Number.isSafeInteger(id) || id < 1) {
      sendJson(response, 400, { error: "Se necesita un tipo válido (movie o tv) y un ID numérico positivo." });
      return;
    }

    const result = await fetchTmdb(`/3/${type}/${id}/watch/providers`, {}, apiToken, fetchImpl);
    if (!result.results || typeof result.results !== "object" || Array.isArray(result.results)) {
      throw new HttpError(502, "TMDb devolvió una respuesta de disponibilidad inválida.");
    }
    const country = result.results && result.results.MX;
    sendJson(response, 200, {
      region: "MX",
      offers: normalizeProviders(country),
      sourceUrl: normalizeSourceUrl(country && country.link)
    });
    return;
  }

  const staticFile = STATIC_FILES.get(url.pathname);
  if (staticFile) {
    const [fileName, contentType] = staticFile;
    const body = await readFile(path.join(__dirname, fileName));
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
    return;
  }

  sendJson(response, 404, { error: "No se encontró esa ruta." });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`PeliDónde disponible en http://${host}:${port}`);
  });
}

module.exports = { createAppServer };
