import { createServer } from "node:http";

/**
 * Sitio de prueba «de un tenant» en otro origen, para probar el script incrustable por CORS.
 * Uso: npm run host:demo -- <clave-del-widget> [url-del-backend] [puerto]
 * El origen `http://localhost:<puerto>` debe estar en los orígenes permitidos del tenant.
 */
const [key = "", api = "http://localhost:3001", port = "4000"] = process.argv.slice(2);

const page = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sitio de prueba del tenant</title>
  </head>
  <body>
    <h1>Sitio de prueba del tenant</h1>
    <p>Esta página vive en otro origen y carga el chat como lo haría el sitio de una clínica.</p>
    <script src="http://localhost:3000/widget.js" data-key="${key}" data-api="${api}" async></script>
  </body>
</html>`;

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
}).listen(Number(port), () => {
  process.stdout.write(`Sitio de prueba en http://localhost:${port}\n`);
});
