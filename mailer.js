// Sends email through nodemailer. Configure with environment variables:
//   SMTP_USER (required), SMTP_PASS (required; for Gmail, use an app password)
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
//   MAIL_FROM (default SMTP_USER), MAIL_FROM_NAME (default "Worship On The Mountain")
//   Replies go to REPLY_TO below (Reply-To header); the From address stays as configured.
// Port 465 connects over implicit TLS. Other ports connect in plain text and must upgrade with STARTTLS.
const nodemailer = require("nodemailer");

const REPLY_TO = "worshiponthemountain@outlook.com";

function mailConfig() {
  const user = process.env.SMTP_USER || "";
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    user,
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || user,
    fromName: process.env.MAIL_FROM_NAME || "Worship On The Mountain",
  };
}

function mailIsConfigured() {
  const config = mailConfig();
  return Boolean(config.user && config.pass && config.from);
}

let transport = null;
let transportKey = "";

// Reuses one connection pool, rebuilding it if the SMTP settings change.
function getTransport(config) {
  const key = [config.host, config.port, config.user, config.pass].join("\n");
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.pass },
    });
    transportKey = key;
  }
  return transport;
}

// Sends one message. Resolves with nodemailer's info object, rejects with the SMTP error otherwise.
// images: [{ cid, filename, contentType, data }] where data is a Buffer, referenced in html as cid:<cid>.
async function sendMail({ to, subject, text, html, images = [] }) {
  const config = mailConfig();
  if (!mailIsConfigured()) throw new Error("Email is not configured (SMTP_USER and SMTP_PASS).");

  return getTransport(config).sendMail({
    from: { name: config.fromName, address: config.from },
    replyTo: REPLY_TO,
    to,
    subject,
    text,
    html,
    attachments: images.map((image) => ({
      filename: image.filename,
      content: image.data,
      contentType: image.contentType,
      cid: image.cid,
      contentDisposition: "inline",
    })),
  });
}

module.exports = { sendMail, mailIsConfigured };
