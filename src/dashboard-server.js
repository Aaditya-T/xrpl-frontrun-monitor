#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      return serveStatic(request, response);
    }

    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  process.stderr.write(`dashboard listening on http://localhost:${port}\n`);
});

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = path.resolve(publicDir, `.${pathname}`);

  if (!target.startsWith(publicDir)) {
    return sendJson(response, { error: "Invalid path" }, 400);
  }

  try {
    const content = await fs.readFile(target);
    response.writeHead(200, { "content-type": contentType(target) });
    response.end(content);
  } catch {
    sendJson(response, { error: "Not found" }, 404);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html";
}
