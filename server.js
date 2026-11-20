// Static file and JSON web server for Worship On The Mountain. Uses only Node built-ins
// (including the built-in node:sqlite database, Node 22.13 or later).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
// Load settings such as ADMIN_PASSWORD from .env (kept out of git). Variables that are
// already set in the environment are not overwritten.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") console.error("Could not read .env: " + err.message);
}
const { sendMail, mailIsConfigured } = require("./mailer");
const {
  buildThankYouEmail,
  buildArtistThankYouEmail,
  buildArtistApprovalEmail,
  buildLineupEmail,
  buildTimeChangeEmail,
} = require("./thank-you");
let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (err) {
  console.error("This server needs Node 22.13 or later (node:sqlite is missing). Current version: " + process.version);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
// Shared secret configured in the GitHub webhook. Deploys are refused without it.
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || "";
// Optional public address of the site (for example https://example.org), used for links in emails.
const SITE_URL = process.env.SITE_URL || "";
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
  CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    about TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'perform',
    services TEXT NOT NULL DEFAULT '',
    needs TEXT NOT NULL DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS performances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    time TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1
  );
`);
// Databases created before approval emails need a column recording when one was sent.
// Artists already approved at that point are marked as handled so they are not emailed after the fact.
if (!db.prepare("SELECT 1 FROM pragma_table_info('artists') WHERE name = 'approval_emailed_at'").get()) {
  db.exec("ALTER TABLE artists ADD COLUMN approval_emailed_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE artists SET approval_emailed_at = 'before-approval-emails' WHERE approved = 1");
}
// Databases created before performances could be hidden need the visible column added.
if (!db.prepare("SELECT 1 FROM pragma_table_info('performances') WHERE name = 'visible'").get()) {
  db.exec("ALTER TABLE performances ADD COLUMN visible INTEGER NOT NULL DEFAULT 1");
}
// Links a performance to an artist record so lineup emails can reach them. Blank means not linked.
if (!db.prepare("SELECT 1 FROM pragma_table_info('performances') WHERE name = 'artist_id'").get()) {
  db.exec("ALTER TABLE performances ADD COLUMN artist_id INTEGER");
}

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
    artists: db
      .prepare(
        "SELECT id, name, about, email, role, services, needs, approved, submitted_at, approval_emailed_at FROM artists ORDER BY id"
      )
      .all(),
    performances: db
      .prepare("SELECT id, artist, title, time, description, position, visible, artist_id FROM performances ORDER BY id")
      .all(),
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
    // Artists and performances were added later, so older backups may not have them.
    const insertArtist = db.prepare(
      "INSERT INTO artists (id, name, about, email, role, services, needs, approved, submitted_at, approval_emailed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const a of snapshot.artists || []) {
      // Older backups lack approval_emailed_at; treat their approved artists as already notified.
      const emailed = a.approval_emailed_at ?? (a.approved ? "before-approval-emails" : "");
      insertArtist.run(a.id, a.name, a.about || "", a.email, a.role || "perform", a.services || "", a.needs || "", a.approved ? 1 : 0, a.submitted_at, emailed);
    }
    const insertPerformance = db.prepare(
      "INSERT INTO performances (id, artist, title, time, description, position, visible, artist_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const p of snapshot.performances || []) {
      const visible = p.visible === undefined || p.visible ? 1 : 0;
      const artistId = p.artist_id ?? null;
      insertPerformance.run(p.id, p.artist, p.title || "", p.time || "", p.description || "", p.position || 0, visible, artistId);
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

// First artist listing: the event organizer, written from his story on the About page.
const SEED_ARTIST = {
  name: "Samuel Wright Jr.",
  about:
    "Samuel Kenneth Wright Jr. is a 38-year-old gospel country music artist from Lewisburg, Tennessee, and the organizer of Worship On The Mountain. He grew up tobacco farming, then worked in welding and fabrication, before answering the call of the Lord and Savior Jesus Christ to lead men.\n\n" +
    "He is a father, a brother, an uncle, a cousin, a friend, a husband, and most of all, a man of God. Samuel speaks openly about his own mental health journey, from foster homes to inpatient facilities, and he wants to take the fear of asking for help away from everybody.",
  email: "outlawlife21@icloud.com",
  role: "both",
  services:
    "Gospel country music performance. Organizing the festival and bringing together the worship groups, choirs, bands and volunteers.",
  needs: "",
};
// Where the one-time review copy of the seed artist's thank-you email goes.
const SEED_REVIEW_EMAIL = "cozmicdragon10@gmail.com";

// Adds the seed artist once, unless artists already exist (for example, restored from backup.json).
function seedArtists() {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'artists_seeded'").get()) return;
  if (!db.prepare("SELECT 1 FROM artists LIMIT 1").get()) {
    const a = SEED_ARTIST;
    db.prepare(
      "INSERT INTO artists (name, about, email, role, services, needs, approved, submitted_at, approval_emailed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'seed')"
    ).run(a.name, a.about, a.email, a.role, a.services, a.needs, new Date().toISOString());
    console.log(`Added ${a.name} to the artists list`);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('artists_seeded', '1')").run();
}
seedArtists();
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
  listApprovedArtists: db.prepare(
    "SELECT name, about, role, services FROM artists WHERE approved = 1 ORDER BY name COLLATE NOCASE"
  ),
  listAllArtists: db.prepare(
    "SELECT id, name, about, email, role, services, needs, approved, submitted_at FROM artists ORDER BY submitted_at DESC, id DESC"
  ),
  insertArtist: db.prepare(
    "INSERT INTO artists (name, about, email, role, services, needs, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ),
  setArtistApproved: db.prepare("UPDATE artists SET approved = ? WHERE id = ?"),
  getArtist: db.prepare("SELECT id, name, email, role, approval_emailed_at FROM artists WHERE id = ?"),
  setApprovalEmailed: db.prepare("UPDATE artists SET approval_emailed_at = ? WHERE id = ?"),
  updateArtist: db.prepare(
    "UPDATE artists SET name = ?, about = ?, email = ?, role = ?, services = ?, needs = ? WHERE id = ?"
  ),
  updateSignup: db.prepare("UPDATE signups SET need_id = ?, name = ?, email = ?, phone = ?, details = ? WHERE id = ?"),
  deleteArtist: db.prepare("DELETE FROM artists WHERE id = ?"),
  listVisiblePerformances: db.prepare(
    "SELECT id, artist, title, time, description FROM performances WHERE visible = 1 ORDER BY position, id"
  ),
  listAllPerformances: db.prepare(
    "SELECT id, artist, title, time, description, visible, artist_id FROM performances ORDER BY position, id"
  ),
  setPerformanceVisible: db.prepare("UPDATE performances SET visible = ? WHERE id = ?"),
  nextPerformancePosition: db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM performances"),
  insertPerformance: db.prepare(
    "INSERT INTO performances (artist, title, time, description, position, artist_id) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  getPerformance: db.prepare("SELECT id, artist, title, time, description, artist_id FROM performances WHERE id = ?"),
  updatePerformance: db.prepare(
    "UPDATE performances SET artist = ?, title = ?, time = ?, description = ?, artist_id = ? WHERE id = ?"
  ),
  deletePerformance: db.prepare("DELETE FROM performances WHERE id = ?"),
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

function serveFile(req, res, filePath, status = 200) {
  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(status, { "Content-Type": type, "Content-Length": stats.size });
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

// ---------- Public artist API ----------

const ARTIST_ROLES = ["perform", "help", "both"];

// Sends the artist thank-you email in the background. Failures are logged and never affect the submission.
function sendArtistThankYou({ name, email, role, services, needs }) {
  if (!mailIsConfigured()) {
    console.log("Artist thank-you email skipped: SMTP_USER and SMTP_PASS are not set.");
    return;
  }
  const message = buildArtistThankYouEmail({ name, role, services, needs });
  sendMail({ to: email, subject: message.subject, text: message.text, html: message.html, images: message.images })
    .then(() => console.log(`Artist thank-you email sent to ${email}`))
    .catch((err) => console.error(`Artist thank-you email to ${email} failed: ${err.message}`));
}

// Used by the public form and the admin edit form.
function validateArtist(body) {
  const name = textField(body, "name");
  const about = textField(body, "about");
  const email = textField(body, "email");
  const role = textField(body, "role");
  const services = textField(body, "services");
  const needs = textField(body, "needs");
  if (!name || name.length > 100) return { error: "Please enter the artist name (100 characters or fewer)." };
  if (!about || about.length > 1500) return { error: "Please fill in the about section (1500 characters or fewer)." };
  if (!EMAIL_PATTERN.test(email) || email.length > 200) return { error: "Please enter a valid email address." };
  if (!ARTIST_ROLES.includes(role)) return { error: "Please choose perform, help out, or both." };
  if (!services || services.length > 500) return { error: "Please list the services offered (500 characters or fewer)." };
  if (needs.length > 500) return { error: "Please keep the needs to 500 characters or fewer." };
  return { name, about, email, role, services, needs };
}

function handleArtistSignup(req, res) {
  readJsonBody(req, 16 * 1024, (err, body) => {
    if (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    const result = validateArtist(body);
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    const { name, about, email, role, services, needs } = result;
    stmt.insertArtist.run(name, about, email, role, services, needs, new Date().toISOString());
    sendJson(res, 201, { status: "ok" });
    sendArtistThankYou({ name, email, role, services, needs });
  });
}

// Sends the seed artist's thank-you email once to SEED_REVIEW_EMAIL (not to the artist) for review.
// It is only marked as sent after it succeeds, so a failure is retried on the next server start.
function sendSeedReviewEmail() {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'seed_review_email_sent'").get()) return;
  if (!mailIsConfigured()) {
    console.log("Seed review email not sent yet: SMTP_USER and SMTP_PASS are not set. It will be tried on the next start.");
    return;
  }
  const a = SEED_ARTIST;
  const message = buildArtistThankYouEmail({ name: a.name, role: a.role, services: a.services, needs: a.needs });
  sendMail({
    to: SEED_REVIEW_EMAIL,
    subject: `[Review copy] ${message.subject}`,
    text: message.text,
    html: message.html,
    images: message.images,
  })
    .then(() => {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_review_email_sent', ?)").run(new Date().toISOString());
      console.log(`Seed review email sent to ${SEED_REVIEW_EMAIL}`);
    })
    .catch((err) => console.error(`Seed review email to ${SEED_REVIEW_EMAIL} failed: ${err.message}`));
}

// Sends the "you're approved" email the first time an artist is approved. It is only recorded as sent
// after it succeeds, so if it fails, approving the artist again (hide, then approve) retries it.
function sendArtistApproval(artist) {
  const message = buildArtistApprovalEmail({ name: artist.name, role: artist.role, siteUrl: SITE_URL });
  sendMail({ to: artist.email, subject: message.subject, text: message.text, html: message.html, images: message.images })
    .then(() => {
      stmt.setApprovalEmailed.run(new Date().toISOString(), artist.id);
      dumpToJson();
      console.log(`Artist approval email sent to ${artist.email}`);
    })
    .catch((err) => console.error(`Artist approval email to ${artist.email} failed: ${err.message}`));
}

// Emails a linked artist about their performance: kind is "added", "removed" or "time-changed"
// (previousTime is only used for "time-changed"). Returns what happened, for the admin page:
// "sending", "not-linked" (no artist record) or "not-configured" (no SMTP login).
function sendLineupEmail(artistId, performance, kind, previousTime = "") {
  const artist = artistId ? stmt.getArtist.get(artistId) : null;
  if (!artist) return "not-linked";
  if (!mailIsConfigured()) return "not-configured";
  const message =
    kind === "time-changed"
      ? buildTimeChangeEmail({ name: artist.name, performance, previousTime, siteUrl: SITE_URL })
      : buildLineupEmail({ name: artist.name, added: kind === "added", performance, siteUrl: SITE_URL });
  const what = kind === "time-changed" ? "time-changed" : kind === "added" ? "added-to-lineup" : "removed-from-lineup";
  sendMail({ to: artist.email, subject: message.subject, text: message.text, html: message.html, images: message.images })
    .then(() => console.log(`Lineup email (${what}) sent to ${artist.email}`))
    .catch((err) => console.error(`Lineup email (${what}) to ${artist.email} failed: ${err.message}`));
  return "sending";
}

// ---------- Admin API and login ----------

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Admin login. The login form (admin-login.html) posts the password to /api/admin-login,
// which sets a session cookie. The cookie value is derived from the password, so changing
// ADMIN_PASSWORD logs everyone out. HTTP Basic login is still accepted for scripts.
const ADMIN_COOKIE = "admin_session";
const ADMIN_SESSION_DAYS = 30;

function adminSessionToken() {
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update("admin-session-v1").digest("hex");
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

function adminCookie(req, value, maxAgeSeconds) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function isAdmin(req) {
  if (safeEqual(readCookie(req, ADMIN_COOKIE), adminSessionToken())) return true;
  const header = req.headers.authorization || "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return colon >= 0 && safeEqual(decoded.slice(colon + 1), ADMIN_PASSWORD);
  }
  return false;
}

function checkAdmin(req, res, pathname) {
  if (!ADMIN_PASSWORD) {
    sendJson(res, 503, { error: "Admin is not configured (ADMIN_PASSWORD is not set)" });
    return false;
  }
  if (isAdmin(req)) return true;
  if (pathname === "/admin.html") {
    // Show the login form in place of the admin page.
    serveFile(req, res, path.join(PUBLIC_DIR, "admin-login.html"), 401);
  } else {
    sendJson(res, 401, { error: "Login required" });
  }
  return false;
}

function handleAdminLogin(req, res) {
  readJsonBody(req, 4 * 1024, (err, body) => {
    if (err) {
      sendJson(res, 400, { error: "Invalid request" });
      return;
    }
    if (!ADMIN_PASSWORD) {
      sendJson(res, 503, { error: "Admin is not configured (ADMIN_PASSWORD is not set)" });
      return;
    }
    const password = body && typeof body.password === "string" ? body.password : "";
    if (!safeEqual(password, ADMIN_PASSWORD)) {
      // Slow down password guessing.
      setTimeout(() => sendJson(res, 401, { error: "Wrong password" }), 1000);
      return;
    }
    res.setHeader("Set-Cookie", adminCookie(req, adminSessionToken(), ADMIN_SESSION_DAYS * 24 * 60 * 60));
    sendJson(res, 200, { ok: true });
  });
}

function handleAdminLogout(req, res) {
  res.setHeader("Set-Cookie", adminCookie(req, "", 0));
  sendJson(res, 200, { ok: true });
}

function validateNeed(body) {
  const name = textField(body, "name");
  const description = textField(body, "description");
  if (!name || name.length > 100) return { error: "Please enter a need name (100 characters or fewer)." };
  if (description.length > 500) return { error: "Please keep the description to 500 characters or fewer." };
  return { name, description };
}

function validatePerformance(body) {
  const artist = textField(body, "artist");
  const title = textField(body, "title");
  const time = textField(body, "time");
  const description = textField(body, "description");
  if (!artist || artist.length > 100) return { error: "Please enter the performer (100 characters or fewer)." };
  if (title.length > 150) return { error: "Please keep the title to 150 characters or fewer." };
  if (time.length > 100) return { error: "Please keep the time to 100 characters or fewer." };
  if (description.length > 1500) return { error: "Please keep the description to 1500 characters or fewer." };
  // Optional link to an artist record ("" or missing means not linked).
  let artistId = null;
  if (body.artistId !== undefined && body.artistId !== null && body.artistId !== "") {
    artistId = Number(body.artistId);
    if (!Number.isInteger(artistId) || !stmt.getArtist.get(artistId)) return { error: "That artist no longer exists." };
  }
  return { artist, title, time, description, artistId };
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

  const artistMatch = pathname.match(/^\/api\/admin\/artists(?:\/(\d+))?$/);
  const approvalMatch = pathname.match(/^\/api\/admin\/artists\/(\d+)\/approval$/);
  const performanceMatch = pathname.match(/^\/api\/admin\/performances(?:\/(\d+))?$/);
  const visibilityMatch = pathname.match(/^\/api\/admin\/performances\/(\d+)\/visibility$/);

  if (performanceMatch && !performanceMatch[1] && req.method === "GET") {
    sendJson(res, 200, stmt.listAllPerformances.all().map((p) => ({ ...p, visible: Boolean(p.visible) })));
    return;
  }

  if (visibilityMatch && req.method === "PUT") {
    withBody(req, res, (body) => {
      const changed = stmt.setPerformanceVisible.run(body.visible ? 1 : 0, Number(visibilityMatch[1])).changes;
      if (!changed) return sendJson(res, 404, { error: "That performance no longer exists." });
      sendJson(res, 200, { status: "ok" });
    });
    return;
  }

  if (artistMatch && !artistMatch[1] && req.method === "GET") {
    sendJson(res, 200, stmt.listAllArtists.all().map((a) => ({ ...a, approved: Boolean(a.approved) })));
    return;
  }

  if (artistMatch && artistMatch[1] && req.method === "PUT") {
    withBody(req, res, (body) => {
      const r = validateArtist(body);
      if (r.error) return sendJson(res, 400, { error: r.error });
      const changed = stmt.updateArtist.run(r.name, r.about, r.email, r.role, r.services, r.needs, Number(artistMatch[1])).changes;
      if (!changed) return sendJson(res, 404, { error: "That artist no longer exists." });
      sendJson(res, 200, { status: "ok" });
    });
    return;
  }

  if (approvalMatch && req.method === "PUT") {
    withBody(req, res, (body) => {
      const artist = stmt.getArtist.get(Number(approvalMatch[1]));
      if (!artist) return sendJson(res, 404, { error: "That artist no longer exists." });
      stmt.setArtistApproved.run(body.approved ? 1 : 0, artist.id);
      // email: "sending" (first approval), "already-sent", "not-configured", or "none" (when hiding).
      let email = "none";
      if (body.approved) {
        if (artist.approval_emailed_at) email = "already-sent";
        else if (!mailIsConfigured()) email = "not-configured";
        else {
          email = "sending";
          sendArtistApproval(artist);
        }
      }
      sendJson(res, 200, { status: "ok", email, to: artist.email });
    });
    return;
  }

  if (artistMatch && artistMatch[1] && req.method === "DELETE") {
    const changed = stmt.deleteArtist.run(Number(artistMatch[1])).changes;
    if (!changed) return sendJson(res, 404, { error: "That artist no longer exists." });
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (performanceMatch && !performanceMatch[1] && req.method === "POST") {
    withBody(req, res, (body) => {
      const result = validatePerformance(body);
      if (result.error) return sendJson(res, 400, { error: result.error });
      const { pos } = stmt.nextPerformancePosition.get();
      stmt.insertPerformance.run(result.artist, result.title, result.time, result.description, pos, result.artistId);
      const email = sendLineupEmail(result.artistId, result, "added");
      sendJson(res, 201, { status: "ok", email });
    });
    return;
  }

  if (performanceMatch && performanceMatch[1] && req.method === "PUT") {
    withBody(req, res, (body) => {
      const result = validatePerformance(body);
      if (result.error) return sendJson(res, 400, { error: result.error });
      const before = stmt.getPerformance.get(Number(performanceMatch[1]));
      if (!before) return sendJson(res, 404, { error: "That performance no longer exists." });
      stmt.updatePerformance.run(result.artist, result.title, result.time, result.description, result.artistId, before.id);
      // Linking the performance to a different artist counts as removing one and adding the other
      // (the "added" email already shows the new time). With the same artist, a new time gets its own notice.
      const emails = {};
      if ((before.artist_id ?? null) !== result.artistId) {
        if (before.artist_id) emails.removed = sendLineupEmail(before.artist_id, before, "removed");
        if (result.artistId) emails.added = sendLineupEmail(result.artistId, result, "added");
      } else if (result.artistId && before.time !== result.time) {
        emails.timeChanged = sendLineupEmail(result.artistId, result, "time-changed", before.time);
      }
      sendJson(res, 200, { status: "ok", emails });
    });
    return;
  }

  if (performanceMatch && performanceMatch[1] && req.method === "DELETE") {
    const performance = stmt.getPerformance.get(Number(performanceMatch[1]));
    if (!performance) return sendJson(res, 404, { error: "That performance no longer exists." });
    stmt.deletePerformance.run(performance.id);
    const email = sendLineupEmail(performance.artist_id, performance, "removed");
    sendJson(res, 200, { status: "ok", email });
    return;
  }

  if (signupMatch && req.method === "PUT") {
    withBody(req, res, (body) => {
      const name = textField(body, "name");
      const email = textField(body, "email");
      const phone = textField(body, "phone");
      const details = textField(body, "details");
      const needId = textField(body, "needId");
      if (!name || name.length > 100) return sendJson(res, 400, { error: "Please enter a name (100 characters or fewer)." });
      if (!EMAIL_PATTERN.test(email) || email.length > 200) return sendJson(res, 400, { error: "Please enter a valid email address." });
      if (phone.length > 30) return sendJson(res, 400, { error: "Phone number is too long." });
      if (details.length > 500) return sendJson(res, 400, { error: "Please keep the note to 500 characters or fewer." });
      if (!stmt.needExists.get(needId)) return sendJson(res, 400, { error: "Please choose a volunteer need." });
      const changed = stmt.updateSignup.run(needId, name, email, phone, details, Number(signupMatch[1])).changes;
      if (!changed) return sendJson(res, 404, { error: "That volunteer no longer exists." });
      sendJson(res, 200, { status: "ok" });
    });
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
  // Performance lineup plus approved artists. Email and needs stay private to the admin page.
  if (pathname === "/api/artists") {
    sendJson(res, 200, { performances: stmt.listVisiblePerformances.all(), artists: stmt.listApprovedArtists.all() });
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

  // Save a fresh JSON copy after every successful change to needs, sign-ups, artists or performances.
  if (
    req.method !== "GET" &&
    (pathname === "/api/volunteer" || pathname === "/api/artists" || pathname.startsWith("/api/admin/"))
  ) {
    res.on("finish", () => {
      if (res.statusCode < 300) dumpToJson();
    });
  }

  if (req.method === "POST" && pathname === "/api/admin-login") {
    handleAdminLogin(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin-logout") {
    handleAdminLogout(req, res);
    return;
  }

  // Admin pages and API require the admin login before anything else.
  if (pathname === "/admin.html" || pathname.startsWith("/api/admin/")) {
    if (!checkAdmin(req, res, pathname)) return;
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

  if (req.method === "POST" && pathname === "/api/artists") {
    handleArtistSignup(req, res);
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
  sendSeedReviewEmail();
  // deploy.sh reads this to know which process to stop on restart.
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`Worship On The Mountain Node server listening on http://localhost:${PORT}`);
});
