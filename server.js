// Static file and JSON web server for Worship On The Mountain. Uses only Node built-ins
// (including the built-in node:sqlite database, Node 22.13 or later).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { sendMail, mailIsConfigured } = require("./mailer");
const { buildThankYouEmail } = require("./thank-you");
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (err) {
  console.error("This server needs Node 22.13 or later (node:sqlite is missing). Current version: " + process.version);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 80;
const PUBLIC_DIR = path.join(__dirname, "public");
// Shared secret configured in the GitHub webhook. Deploys are refused without it.
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || "";
// Password for the admin pages (username can be anything). Admin is disabled when unset.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const PID_FILE = path.join(__dirname, "server.pid");
// Runtime data (git-ignored, never served as static files).
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
// JSON copy of all needs and sign-ups, rewritten after every change and reloaded if the database is missing.
const BACKUP_FILE = path.join(DATA_DIR, "backup.json");

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

// ---------- Database ----------

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS needs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    need_id TEXT NOT NULL REFERENCES needs(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    signed_up_at TEXT NOT NULL
  );
`);

// Needs listed on the home page, loaded once when the database is first created.
const INITIAL_NEEDS = [
  { name: "Setup and teardown", description: "Set up tents, chairs, tables and signs before the event, and take them down afterward." },
  { name: "Parking and directions", description: "Guide cars into parking and help guests find their way around the grounds." },
  { name: "Food and hospitality", description: "Prepare, serve and clean up meals and drinks, and welcome guests." },
  { name: "Sound and stage", description: "Run the sound system, microphones and stage lighting during services." },
  { name: "First aid", description: "Stay on hand to assist guests who need medical attention." },
  { name: "Security", description: "Help keep the grounds safe and orderly for everyone." },
  { name: "Cleanup", description: "Pick up trash and restore the grounds after the event." },
];

function buildSnapshot() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    needs: db.prepare("SELECT id, name, description, position FROM needs ORDER BY position, name").all(),
    signups: db.prepare("SELECT id, need_id, name, email, phone, details, signed_up_at FROM signups ORDER BY id").all(),
  };
}

// Rewrites backup.json atomically (temp file, then rename) so a crash never leaves it half-written.
function dumpToJson() {
  try {
    const tmp = BACKUP_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(buildSnapshot(), null, 2));
    fs.renameSync(tmp, BACKUP_FILE);
  } catch (err) {
    console.error("Could not write backup:", err.message);
  }
}

function readBackup() {
  if (!fs.existsSync(BACKUP_FILE)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
    if (!Array.isArray(snapshot.needs) || !Array.isArray(snapshot.signups)) throw new Error("missing needs or signups");
    return snapshot;
  } catch (err) {
    // Keep the unreadable file for inspection instead of overwriting it with a new backup.
    const kept = path.join(DATA_DIR, `backup.corrupt-${Date.now()}.json`);
    fs.renameSync(BACKUP_FILE, kept);
    console.error(`Backup was unreadable (${err.message}); moved to ${kept}`);
    return null;
  }
}

function loadSnapshot(snapshot) {
  db.exec("BEGIN");
  try {
    const insertNeed = db.prepare("INSERT INTO needs (id, name, description, position) VALUES (?, ?, ?, ?)");
    for (const n of snapshot.needs) insertNeed.run(n.id, n.name, n.description || "", n.position || 0);
    const insertSignup = db.prepare(
      "INSERT INTO signups (id, need_id, name, email, phone, details, signed_up_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const s of snapshot.signups) {
      insertSignup.run(s.id, s.need_id, s.name, s.email, s.phone || "", s.details || "", s.signed_up_at);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// On a fresh database: restore from backup.json if it exists, otherwise add the home-page needs.
function initializeStore() {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'needs_seeded'").get()) return;
  const snapshot = readBackup();
  if (snapshot) {
    loadSnapshot(snapshot);
    console.log(`Restored ${snapshot.needs.length} needs and ${snapshot.signups.length} sign-ups from backup.json`);
  } else {
    const insert = db.prepare("INSERT INTO needs (id, name, description, position) VALUES (?, ?, ?, ?)");
    INITIAL_NEEDS.forEach((need, index) => insert.run(crypto.randomUUID(), need.name, need.description, index));
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('needs_seeded', '1')").run();
}
initializeStore();
dumpToJson();

const stmt = {
  listNeeds: db.prepare("SELECT id, name, description FROM needs ORDER BY position, name"),
  listSignups: db.prepare(
    "SELECT id, need_id, name, email, phone, details, signed_up_at FROM signups ORDER BY signed_up_at, id"
  ),
  needExists: db.prepare("SELECT 1 FROM needs WHERE id = ?"),
  signupCount: db.prepare("SELECT COUNT(*) AS n FROM signups WHERE need_id = ?"),
  nextPosition: db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM needs"),
  insertNeed: db.prepare("INSERT INTO needs (id, name, description, position) VALUES (?, ?, ?, ?)"),
  updateNeed: db.prepare("UPDATE needs SET name = ?, description = ? WHERE id = ?"),
  deleteNeed: db.prepare("DELETE FROM needs WHERE id = ?"),
  insertSignup: db.prepare(
    "INSERT INTO signups (need_id, name, email, phone, details, signed_up_at) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  deleteSignup: db.prepare("DELETE FROM signups WHERE id = ?"),
};

// Needs with their volunteers. The public view shows names only; the admin view adds contact details.
function groupedNeeds(includePrivate) {
  const signupsByNeed = new Map();
  for (const row of stmt.listSignups.all()) {
    const volunteer = includePrivate
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          details: row.details,
          signedUpAt: row.signed_up_at,
        }
      : { name: row.name, details: row.details };
    if (!signupsByNeed.has(row.need_id)) signupsByNeed.set(row.need_id, []);
    signupsByNeed.get(row.need_id).push(volunteer);
  }
  return stmt.listNeeds.all().map((need) => ({
    id: need.id,
    name: need.name,
    description: need.description,
    volunteers: signupsByNeed.get(need.id) || [],
  }));
}

// ---------- HTTP helpers ----------

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

function readJsonBody(req, limit, callback) {
  const chunks = [];
  let size = 0;
  let done = false;
  req.on("data", (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > limit) {
      done = true;
      callback(new Error("Request body too large"));
    } else {
      chunks.push(chunk);
    }
  });
  req.on("end", () => {
    if (done) return;
    done = true;
    try {
      callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (_) {
      callback(new Error("Invalid JSON"));
    }
  });
}

function textField(body, key) {
  return typeof body[key] === "string" ? body[key].trim() : "";
}

// ---------- Public volunteer API ----------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sends the thank-you email in the background. Failures are logged and never affect the sign-up.
function sendThankYou({ name, email, needId, details }) {
  if (!mailIsConfigured()) {
    console.log("Thank-you email skipped: SMTP_USER and SMTP_PASS are not set.");
    return;
  }
  const need = db.prepare("SELECT name, description FROM needs WHERE id = ?").get(needId);
  if (!need) return;
  const email_ = buildThankYouEmail({
    name,
    needName: need.name,
    needDescription: need.description,
    details,
  });
  sendMail({ to: email, subject: email_.subject, text: email_.text, html: email_.html, images: email_.images })
    .then(() => console.log(`Thank-you email sent to ${email}`))
    .catch((err) => console.error(`Thank-you email to ${email} failed: ${err.message}`));
}

function handleVolunteer(req, res) {
  readJsonBody(req, 16 * 1024, (err, body) => {
    if (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    const name = textField(body, "name");
    const email = textField(body, "email");
    const phone = textField(body, "phone");
    const details = textField(body, "details");
    const needId = textField(body, "needId");
    if (!name || name.length > 100) {
      sendJson(res, 400, { error: "Please enter your name (100 characters or fewer)." });
      return;
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 200) {
      sendJson(res, 400, { error: "Please enter a valid email address." });
      return;
    }
    if (phone.length > 30) {
      sendJson(res, 400, { error: "Phone number is too long." });
      return;
    }
    if (details.length > 500) {
      sendJson(res, 400, { error: "Please keep the description to 500 characters or fewer." });
      return;
    }
    if (!stmt.needExists.get(needId)) {
      sendJson(res, 400, { error: "Please choose a volunteer need." });
      return;
    }
    stmt.insertSignup.run(needId, name, email, phone, details, new Date().toISOString());
    sendJson(res, 201, { status: "ok" });
    sendThankYou({ name, email, needId, details });
  });
}

// ---------- Admin API and login ----------

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// HTTP Basic login. The browser remembers it for the admin page and its API calls.
function checkAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    sendJson(res, 503, { error: "Admin is not configured (ADMIN_PASSWORD is not set)" });
    return false;
  }
  const header = req.headers.authorization || "";
  let ok = false;
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    ok = colon >= 0 && safeEqual(decoded.slice(colon + 1), ADMIN_PASSWORD);
  }
  if (!ok) {
    res.writeHead(401, {
      "Content-Type": MIME_TYPES[".json"],
      "WWW-Authenticate": 'Basic realm="Worship On The Mountain admin", charset="UTF-8"',
    });
    res.end(JSON.stringify({ error: "Login required" }));
    return false;
  }
  return true;
}

function validateNeed(body) {
  const name = textField(body, "name");
  const description = textField(body, "description");
  if (!name || name.length > 100) return { error: "Please enter a need name (100 characters or fewer)." };
  if (description.length > 500) return { error: "Please keep the description to 500 characters or fewer." };
  return { name, description };
}

function withBody(req, res, handler) {
  readJsonBody(req, 16 * 1024, (err, body) => {
    if (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    handler(body);
  });
}

function handleAdminApi(req, res, pathname) {
  if (pathname === "/api/admin/export" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[".json"],
      "Content-Disposition": 'attachment; filename="worship-backup.json"',
    });
    res.end(JSON.stringify(buildSnapshot(), null, 2));
    return;
  }

  const needMatch = pathname.match(/^\/api\/admin\/needs(?:\/([^/]+))?$/);
  const signupMatch = pathname.match(/^\/api\/admin\/signups\/(\d+)$/);

  if (needMatch && !needMatch[1] && req.method === "GET") {
    sendJson(res, 200, groupedNeeds(true));
    return;
  }

  if (needMatch && !needMatch[1] && req.method === "POST") {
    withBody(req, res, (body) => {
      const result = validateNeed(body);
      if (result.error) return sendJson(res, 400, { error: result.error });
      const { pos } = stmt.nextPosition.get();
      stmt.insertNeed.run(crypto.randomUUID(), result.name, result.description, pos);
      sendJson(res, 201, { status: "ok" });
    });
    return;
  }

  if (needMatch && needMatch[1] && req.method === "PUT") {
    withBody(req, res, (body) => {
      const result = validateNeed(body);
      if (result.error) return sendJson(res, 400, { error: result.error });
      const changed = stmt.updateNeed.run(result.name, result.description, needMatch[1]).changes;
      if (!changed) return sendJson(res, 404, { error: "That need no longer exists." });
      sendJson(res, 200, { status: "ok" });
    });
    return;
  }

  if (needMatch && needMatch[1] && req.method === "DELETE") {
    if (stmt.signupCount.get(needMatch[1]).n > 0) {
      sendJson(res, 409, { error: "Remove the volunteers for this need before deleting it." });
      return;
    }
    const changed = stmt.deleteNeed.run(needMatch[1]).changes;
    if (!changed) return sendJson(res, 404, { error: "That need no longer exists." });
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (signupMatch && req.method === "DELETE") {
    const changed = stmt.deleteSignup.run(Number(signupMatch[1])).changes;
    if (!changed) return sendJson(res, 404, { error: "That volunteer no longer exists." });
    sendJson(res, 200, { status: "ok" });
    return;
  }

  sendJson(res, 404, { error: "Unknown admin route" });
}

// ---------- Other API routes ----------

function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", uptime: process.uptime() });
    return;
  }
  if (pathname === "/api/needs") {
    sendJson(res, 200, groupedNeeds(false));
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

// ---------- Router ----------

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Save a fresh JSON copy after every successful change to volunteer needs or sign-ups.
  if (req.method !== "GET" && (pathname === "/api/volunteer" || pathname.startsWith("/api/admin/"))) {
    res.on("finish", () => {
      if (res.statusCode < 300) dumpToJson();
    });
  }

  // Admin pages and API require the admin login before anything else.
  if (pathname === "/admin.html" || pathname.startsWith("/api/admin/")) {
    if (!checkAdmin(req, res)) return;
    if (pathname.startsWith("/api/admin/")) {
      handleAdminApi(req, res, pathname);
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/deploy") {
    handleDeploy(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/volunteer") {
    handleVolunteer(req, res);
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
