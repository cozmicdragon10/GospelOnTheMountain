// Minimal SMTP sender using only Node built-ins. Connects over TLS (implicit TLS, port 465 by default)
// and logs in with AUTH LOGIN. For Gmail, use an app password for SMTP_PASS.
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

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

function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(text) {
  return Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g).join("\r\n");
}

function wrapBase64Buffer(buffer) {
  return buffer.toString("base64").match(/.{1,76}/g).join("\r\n");
}

// Builds a multipart message: HTML and plain text alternatives, plus inline images referenced by cid.
function buildMessage({ from, fromName, to, subject, text, html, images = [] }) {
  const domain = from.split("@")[1] || "localhost";
  const altBoundary = "alt_" + crypto.randomBytes(12).toString("hex");
  const relBoundary = "rel_" + crypto.randomBytes(12).toString("hex");
  const lines = [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${relBoundary}"`,
    "",
    `--${relBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(text),
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(html),
    `--${altBoundary}--`,
  ];
  for (const image of images) {
    lines.push(
      `--${relBoundary}`,
      `Content-Type: ${image.contentType}; name="${image.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${image.cid}>`,
      `Content-Disposition: inline; filename="${image.filename}"`,
      "",
      wrapBase64Buffer(image.data)
    );
  }
  lines.push(`--${relBoundary}--`, "");
  return lines.join("\r\n");
}

// Sends one message. Resolves when the server accepts it, rejects with the SMTP error otherwise.
function sendMail({ to, subject, text, html, images }) {
  const config = mailConfig();
  if (!mailIsConfigured()) return Promise.reject(new Error("Email is not configured (SMTP_USER and SMTP_PASS)."));
  const message = buildMessage({ from: config.from, fromName: config.fromName, to, subject, text, html, images });

  // Port 465 uses TLS from the start. Other ports (such as iCloud's 587) connect in plain text,
  // then upgrade to TLS with STARTTLS.
  const implicitTls = config.port === 465;

  return new Promise((resolve, reject) => {
    let socket = implicitTls
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port });
    let partial = "";
    let lines = [];
    const replies = [];
    let waiting = null;
    let finished = false;

    function fail(err) {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(err);
    }

    function onData(chunk) {
      partial += chunk.toString("utf8");
      let end;
      while ((end = partial.indexOf("\r\n")) >= 0) {
        const line = partial.slice(0, end);
        partial = partial.slice(end + 2);
        lines.push(line);
        const match = /^(\d{3})([ -])/.exec(line);
        if (match && match[2] === " ") {
          const reply = { code: Number(match[1]), text: lines.join("\n") };
          lines = [];
          if (waiting) {
            const next = waiting;
            waiting = null;
            next(reply);
          } else {
            replies.push(reply);
          }
        }
      }
    }

    function attach(s) {
      s.setTimeout(30000);
      s.on("data", onData);
      s.on("error", fail);
      s.on("timeout", () => fail(new Error("SMTP connection timed out")));
      s.on("close", () => fail(new Error("SMTP connection closed unexpectedly")));
    }
    attach(socket);

    // Sends a command (or nothing, when waiting for the greeting) and checks the reply code.
    function step(command, okCodes) {
      if (command !== null) socket.write(command + "\r\n");
      return new Promise((res, rej) => {
        const check = (reply) => {
          if (okCodes.includes(reply.code)) res(reply);
          else rej(new Error(`SMTP error ${reply.code}: ${reply.text}`));
        };
        if (replies.length) check(replies.shift());
        else waiting = check;
      });
    }

    (async () => {
      await step(null, [220]);
      await step("EHLO worship-on-the-mountain", [250]);
      if (!implicitTls) {
        await step("STARTTLS", [220]);
        // Hand the plain connection to TLS, with no leftover listeners reading raw bytes.
        const plain = socket;
        plain.removeAllListeners("data");
        plain.removeAllListeners("error");
        plain.removeAllListeners("close");
        plain.removeAllListeners("timeout");
        socket = tls.connect({ socket: plain, servername: config.host });
        await new Promise((res, rej) => {
          socket.once("secureConnect", res);
          socket.once("error", rej);
        });
        attach(socket);
        await step("EHLO worship-on-the-mountain", [250]);
      }
      await step("AUTH LOGIN", [334]);
      await step(Buffer.from(config.user).toString("base64"), [334]);
      await step(Buffer.from(config.pass).toString("base64"), [235]);
      await step(`MAIL FROM:<${config.from}>`, [250]);
      await step(`RCPT TO:<${to}>`, [250, 251]);
      await step("DATA", [354]);
      // Dot-stuff any line starting with "." and end the message with a lone dot.
      const body = message.replace(/\r\n\./g, "\r\n..");
      await step(body + "\r\n.", [250]);
      await step("QUIT", [221]);
      finished = true;
      socket.end();
      resolve();
    })().catch(fail);
  });
}

module.exports = { sendMail, mailIsConfigured };
