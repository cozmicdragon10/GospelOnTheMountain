// Minimal static file and JSON web server for Worship On The Mountain. Uses only Node built-ins.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
// Shared secret configured in the GitHub webhook. Deploys are refused without it.
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || "";
const PID_FILE = path.join(__dirname, "server.pid");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(body));
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": stats.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", uptime: process.uptime() });
    return;
  }
  sendJson(res, 404, { error: "Unknown API route" });
}

// GitHub webhook: verifies the HMAC signature, then runs deploy.sh detached so it
// can restart this server without killing itself.
function handleDeploy(req, res) {
  if (!DEPLOY_SECRET) {
    sendJson(res, 503, { error: "Deploy is not configured (DEPLOY_SECRET is not set)" });
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 1024 * 1024) req.destroy();
    else chunks.push(chunk);
  });
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const expected = "sha256=" + crypto.createHmac("sha256", DEPLOY_SECRET).update(body).digest("hex");
    const given = Buffer.from(req.headers["x-hub-signature-256"] || "");
    const want = Buffer.from(expected);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      sendJson(res, 401, { error: "Bad signature" });
      return;
    }
    const event = req.headers["x-github-event"];
    if (event === "ping") {
      sendJson(res, 200, { status: "pong" });
      return;
    }
    let ref = null;
    try {
      ref = JSON.parse(body.toString("utf8")).ref;
    } catch (_) {
      // Leave ref null; it is rejected below.
    }
    if (event !== "push" || ref !== "refs/heads/main") {
      sendJson(res, 200, { status: "ignored", event, ref });
      return;
    }
    const child = spawn("bash", [path.join(__dirname, "deploy.sh")], {
      cwd: __dirname,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    sendJson(res, 202, { status: "deploying" });
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "POST" && pathname === "/api/deploy") {
    handleDeploy(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD, POST" });
    res.end();
    return;
  }

  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname);
    return;
  }

  // Resolve the requested path inside PUBLIC_DIR and reject anything that escapes it.
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  // deploy.sh reads this to know which process to stop on restart.
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`Worship On The Mountain Node server listening on http://localhost:${PORT}`);
});
