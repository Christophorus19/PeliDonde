const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { createAppServer } = require("./server");

const servers = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function startServer(options) {
  const server = createAppServer(options);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("search returns movie and series results, excluding people", async () => {
  let requestedUrl;
  let authorization;
  const baseUrl = await startServer({
    apiToken: "test-token",
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      authorization = options.headers.Authorization;
      return jsonResponse({
        results: [
          { id: 1, media_type: "movie", title: "Dune", original_title: "Dune: Part Two", release_date: "2024-03-01", poster_path: "/dune.jpg" },
          { id: 2, media_type: "tv", name: "El oso", original_name: "The Bear", first_air_date: "2022-06-23" },
          { id: 3, media_type: "person", name: "Actor" }
        ]
      });
    }
  });

  const response = await fetch(`${baseUrl}/api/search?q=Dune&type=all`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requestedUrl.pathname, "/3/search/multi");
  assert.equal(requestedUrl.searchParams.get("query"), "Dune");
  assert.equal(requestedUrl.searchParams.get("language"), "es-MX");
  assert.equal(requestedUrl.searchParams.get("include_adult"), "false");
  assert.equal(authorization, "Bearer test-token");
  assert.deepEqual(body.results.map((result) => result.mediaType), ["movie", "tv"]);
  assert.equal(body.results[0].posterUrl, "https://image.tmdb.org/t/p/w185/dune.jpg");
  assert.equal(body.results[1].title, "El oso");
});

test("provider query maps Mexico subscription, rent, and purchase offers", async () => {
  const baseUrl = await startServer({
    apiToken: "test-token",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/3/movie/42/watch/providers");
      return jsonResponse({
        results: {
          MX: {
            link: "https://www.themoviedb.org/movie/42/watch?locale=MX",
            flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/netflix.jpg" }],
            rent: [{ provider_id: 2, provider_name: "Apple TV" }],
            buy: [{ provider_id: 10, provider_name: "Amazon Video" }]
          },
          US: { flatrate: [{ provider_id: 99, provider_name: "US only" }] }
        }
      });
    }
  });

  const response = await fetch(`${baseUrl}/api/providers?type=movie&id=42`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.region, "MX");
  assert.deepEqual(body.offers.map((offer) => offer.type), ["subscription", "rent", "buy"]);
  assert.deepEqual(body.offers.map((offer) => offer.providerName), ["Netflix", "Apple TV", "Amazon Video"]);
  assert.equal(body.offers[0].logoUrl, "https://image.tmdb.org/t/p/w92/netflix.jpg");
  assert.equal(body.sourceUrl, "https://www.themoviedb.org/movie/42/watch?locale=MX");
});

test("invalid provider identifiers are rejected before contacting TMDb", async () => {
  const baseUrl = await startServer({
    apiToken: "test-token",
    fetchImpl: async () => {
      throw new Error("TMDb should not be called for invalid input");
    }
  });

  const response = await fetch(`${baseUrl}/api/providers?type=movie&id=0`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /ID numérico positivo/);
});

test("missing TMDb token returns an actionable configuration error", async () => {
  const baseUrl = await startServer({ apiToken: "" });
  const response = await fetch(`${baseUrl}/api/search?q=Dune`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /TMDB_API_READ_ACCESS_TOKEN/);
});
