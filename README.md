# PeliDónde

Buscador de películas y series para México. El catálogo no está escrito a mano: las búsquedas consultan TMDb y la disponibilidad se consulta por título e identificador.

## Requisitos

- Node.js 22.9 o posterior
- Un token de lectura de la API de TMDb

## Configuración

1. Crea una cuenta en [TMDb](https://www.themoviedb.org/) y solicita acceso a la API en la configuración de tu cuenta.
2. Copia `.env.example` como `.env`.
3. En `.env`, reemplaza el valor de `TMDB_API_READ_ACCESS_TOKEN` con tu token de lectura.
4. Ejecuta `npm start` y abre `http://127.0.0.1:3000`.

El token se usa únicamente en el servidor. `.env` está excluido de Git; no pegues el token en el código, en el navegador ni en GitHub.

## Uso y pruebas

- Busca por nombre y filtra por película, serie o ambos.
- Selecciona el título correcto entre los resultados y consulta proveedores para México.
- La disponibilidad se agrupa en suscripción, renta, compra, gratis y con anuncios cuando la fuente la proporciona.
- Ejecuta `npm test` para las pruebas del servidor.

Las búsquedas requieren conexión a Internet y un token válido. La cobertura depende de TMDb/JustWatch; si no hay resultados para México, la app lo indicará en vez de asumir una plataforma.

## Atribución

La disponibilidad de streaming proviene de JustWatch mediante la API de TMDb. JustWatch requiere atribución para estos datos. Los enlaces de disponibilidad llevan a la ficha de TMDb; la API no garantiza enlaces directos a cada proveedor.

This product uses the TMDB API but is not endorsed or certified by TMDB.
