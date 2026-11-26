const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search");
const mediaTypeInput = document.querySelector("#media-type");
const searchButton = document.querySelector("#search-button");
const searchStatus = document.querySelector("#search-status");
const searchResults = document.querySelector("#search-results");
const resultCount = document.querySelector("#result-count");
const reportDialog = document.querySelector("#report-dialog");
const reportForm = document.querySelector("#report-form");
const reportOfferText = document.querySelector("#report-offer");
const reportStorageError = document.querySelector("#report-storage-error");
const savedReportsElement = document.querySelector("#saved-reports");
const reportCount = document.querySelector("#report-count");
const formMessage = document.querySelector("#form-message");
const reportStorageKey = "pelidonde:reports";
const offerGroups = [
  ["subscription", "Incluida con suscripción"],
  ["rent", "Renta"],
  ["buy", "Compra"],
  ["free", "Gratis"],
  ["ads", "Con anuncios"]
];

let activeReport = null;
let localReports = [];
let reportStorageAvailable = true;

function setStatus(message, isError = false) {
  searchStatus.textContent = message;
  searchStatus.classList.toggle("error", isError);
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error("No se pudo conectar con PeliDónde. Comprueba que el servidor esté activo.");
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("El servidor devolvió una respuesta inválida.");
  }
  if (!response.ok) throw new Error(body.error || "No se pudo completar la consulta.");
  return body;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderSearchResult(result) {
  const card = createElement("article", "movie-card");
  if (result.posterUrl) {
    const poster = createElement("img", "poster");
    poster.src = result.posterUrl;
    poster.alt = "";
    poster.loading = "lazy";
    poster.addEventListener("error", () => poster.replaceWith(createElement("div", "poster-placeholder", "▶")), { once: true });
    card.append(poster);
  } else {
    card.append(createElement("div", "poster-placeholder", "▶"));
  }

  const info = createElement("div", "movie-info");
  const titleRow = createElement("div", "movie-title-row");
  titleRow.append(
    createElement("h3", "movie-title", result.title),
    createElement("span", "kind", result.mediaType === "movie" ? "Película" : "Serie")
  );
  info.append(titleRow);

  const metadata = [result.year, result.originalTitle && result.originalTitle !== result.title ? result.originalTitle : ""]
    .filter(Boolean)
    .join(" · ");
  if (metadata) info.append(createElement("p", "meta", metadata));
  if (result.overview) info.append(createElement("p", "overview", result.overview));

  const actions = createElement("div", "card-actions");
  const availabilityButton = createElement("button", "primary-button", "Consultar disponibilidad");
  availabilityButton.type = "button";
  actions.append(availabilityButton);
  info.append(actions);

  const availability = createElement("div", "availability");
  availability.hidden = true;
  availability.setAttribute("aria-live", "polite");
  info.append(availability);

  availabilityButton.addEventListener("click", async () => {
    availabilityButton.disabled = true;
    availabilityButton.textContent = "Consultando…";
    availability.hidden = false;
    availability.replaceChildren(createElement("p", "offer-status", "Consultando proveedores para México…"));
    try {
      const params = new URLSearchParams({ type: result.mediaType, id: String(result.id) });
      const response = await requestJson(`/api/providers?${params}`);
      renderAvailability(availability, result, response);
      availabilityButton.textContent = "Actualizar disponibilidad";
    } catch (error) {
      availability.replaceChildren(createElement("p", "offer-status error", error.message));
      availabilityButton.textContent = "Reintentar consulta";
    } finally {
      availabilityButton.disabled = false;
    }
  });

  card.append(info);
  return card;
}

function renderAvailability(container, result, response) {
  container.replaceChildren();
  if (!response.offers.length) {
    container.append(createElement("p", "offer-status", "La fuente no muestra opciones de disponibilidad para México en este momento."));
  } else {
    offerGroups.forEach(([type, label]) => {
      const offers = response.offers.filter((offer) => offer.type === type);
      if (!offers.length) return;

      const group = createElement("section", "availability-group");
      group.append(createElement("h4", "", label));
      const providerList = createElement("div", "provider-list");
      offers.forEach((offer) => {
        const provider = createElement("div", "provider");
        if (offer.logoUrl) {
          const logo = createElement("img", "provider-logo");
          logo.src = offer.logoUrl;
          logo.alt = "";
          logo.loading = "lazy";
          logo.addEventListener("error", () => logo.remove(), { once: true });
          provider.append(logo);
        }
        provider.append(createElement("span", "", offer.providerName));
        const reportButton = createElement("button", "report-button", "Reportar");
        reportButton.type = "button";
        reportButton.addEventListener("click", () => openReport(result, offer));
        provider.append(reportButton);
        providerList.append(provider);
      });
      group.append(providerList);
      container.append(group);
    });
  }

  if (response.sourceUrl) {
    const sourceLink = createElement("a", "source-link", "Ver fuente de disponibilidad en TMDb");
    sourceLink.href = response.sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    container.append(sourceLink);
  }
  container.append(createElement("p", "offer-status", `Consulta realizada: ${new Date().toLocaleString("es-MX")}.`));
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setStatus("Escribe el nombre de una película o serie.", true);
    return;
  }

  searchButton.disabled = true;
  searchButton.textContent = "Buscando…";
  searchResults.replaceChildren();
  resultCount.textContent = "";
  setStatus("Buscando títulos…");

  try {
    const params = new URLSearchParams({ q: query, type: mediaTypeInput.value });
    const response = await requestJson(`/api/search?${params}`);
    resultCount.textContent = `(${response.results.length})`;
    if (!response.results.length) {
      setStatus("No encontramos títulos. Prueba otro nombre o cambia el tipo de búsqueda.");
      searchResults.append(createElement("div", "empty-state", "No hay resultados para esta búsqueda."));
      return;
    }

    response.results.forEach((result) => searchResults.append(renderSearchResult(result)));
    setStatus("Elige el título correcto y consulta sus opciones para México.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "Buscar";
  }
});

function renderReports() {
  reportCount.textContent = `(${localReports.length})`;
  savedReportsElement.replaceChildren();
  localReports.forEach((report) => {
    const entry = createElement("article", "saved-report");
    entry.append(createElement("strong", "", `${report.title} — ${report.provider} (${report.availability})`));
    entry.append(createElement("p", "", report.reason));
    entry.append(createElement("p", "", new Date(report.reportedAt).toLocaleString("es-MX")));
    if (report.details) entry.append(createElement("p", "", report.details));
    savedReportsElement.append(entry);
  });
}

try {
  const savedValue = localStorage.getItem(reportStorageKey);
  if (savedValue) {
    const parsedReports = JSON.parse(savedValue);
    if (!Array.isArray(parsedReports)) throw new Error("El historial no tiene el formato esperado.");
    localReports = parsedReports.map((report) => {
      if (!report || typeof report !== "object" || typeof report.title !== "string") {
        throw new Error("Un reporte guardado tiene un formato inválido.");
      }
      const provider = report.provider || report.platform;
      if (typeof provider !== "string" || typeof report.reason !== "string") {
        throw new Error("Un reporte guardado no contiene los campos requeridos.");
      }
      return { ...report, provider };
    });
  }
} catch (error) {
  reportStorageAvailable = false;
  reportStorageError.hidden = false;
  reportStorageError.textContent = "No se pudo leer el historial local de reportes.";
  console.error("No se pudo leer el historial local de reportes.", error);
}

function openReport(result, offer) {
  const availabilityLabel = offerGroups.find(([type]) => type === offer.type)?.[1] || offer.type;
  activeReport = {
    title: result.title,
    provider: offer.providerName,
    availability: availabilityLabel
  };
  reportOfferText.textContent = `${result.title} — ${offer.providerName} · ${availabilityLabel}`;
  reportForm.reset();
  formMessage.hidden = true;
  reportDialog.showModal();
}

document.querySelector(".close-button").addEventListener("click", () => reportDialog.close());
reportDialog.addEventListener("click", (event) => {
  if (event.target === reportDialog) reportDialog.close();
});
reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!reportForm.reportValidity() || !activeReport) return;
  if (!reportStorageAvailable) {
    formMessage.textContent = "No se pudo guardar el reporte en este navegador.";
    formMessage.hidden = false;
    return;
  }

  const report = {
    ...activeReport,
    reason: reportForm.querySelector("#report-reason").value,
    details: reportForm.querySelector("#report-details").value.trim(),
    reportedAt: new Date().toISOString()
  };
  const updatedReports = [report, ...localReports];
  try {
    localStorage.setItem(reportStorageKey, JSON.stringify(updatedReports));
  } catch (error) {
    reportStorageAvailable = false;
    reportStorageError.hidden = false;
    reportStorageError.textContent = "El navegador no permitió guardar el reporte localmente.";
    formMessage.textContent = "No se pudo guardar el reporte.";
    formMessage.hidden = false;
    console.error("No se pudo guardar el reporte localmente.", error);
    return;
  }

  localReports = updatedReports;
  renderReports();
  document.querySelector("#report-history").open = true;
  formMessage.textContent = "Reporte guardado únicamente en este navegador.";
  formMessage.hidden = false;
  reportForm.querySelector(".submit-button").disabled = true;
});

reportDialog.addEventListener("close", () => {
  reportForm.querySelector(".submit-button").disabled = false;
  activeReport = null;
});

renderReports();
