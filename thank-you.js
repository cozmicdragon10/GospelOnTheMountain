// Thank-you email sent to each new volunteer.
const fs = require("fs");
const path = require("path");

const POSTER_FILE = path.join(__dirname, "public", "img", "Evt2.jpg");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildThankYouEmail({ name, needName, needDescription, details }) {
  const subject = "Thank you for volunteering with Worship On The Mountain!";

  const text = [
    `Dear ${name},`,
    "",
    "Thank you for volunteering to serve at Worship On The Mountain! We are grateful for your time and your heart for this event.",
    "",
    `You signed up to help with: ${needName}`,
    needDescription ? needDescription : "",
    details ? `Your note: ${details}` : "",
    "",
    "The exact date is still to be determined. We will be in touch with more details as they are confirmed.",
    "",
    "If you have any questions or need more information, please contact Samuel Wright Jr.:",
    "Email: outlawlife21@icloud.com",
    "Phone: 931-261-8205",
    "",
    "He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!",
    "",
    "With gratitude,",
    "Worship On The Mountain",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 16px;color:#1b2a4a;font-size:26px;text-align:center;">Thank you for volunteering!</h1>
      <p>Dear ${escapeHtml(name)},</p>
      <p>Thank you for volunteering to serve at <strong>Worship On The Mountain</strong>! We are grateful for your time and your heart for this event.</p>
      <div style="border-left:4px solid #c9a227;background:#fbf7ee;padding:12px 16px;margin:16px 0;">
        <p style="margin:0 0 6px;"><strong>You signed up to help with:</strong> ${escapeHtml(needName)}</p>
        ${needDescription ? `<p style="margin:0 0 6px;">${escapeHtml(needDescription)}</p>` : ""}
        ${details ? `<p style="margin:0;"><em>Your note:</em> ${escapeHtml(details)}</p>` : ""}
      </div>
      <p><strong>Date:</strong> Exact date to be determined. We will be in touch with more details as they are confirmed.</p>
      <img src="cid:evt2" alt="Worship On The Mountain event poster" style="display:block;max-width:100%;height:auto;margin:20px auto;border:6px solid #ffffff;outline:1px solid #c9a227;">
      <p>If you have any questions or need more information, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:outlawlife21@icloud.com" style="color:#2c4170;">outlawlife21@icloud.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9312618205" style="color:#2c4170;">931-261-8205</a></p>
      <p style="font-style:italic;color:#1b2a4a;">He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!</p>
      <p style="margin-bottom:0;">With gratitude,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  const images = [];
  if (fs.existsSync(POSTER_FILE)) {
    images.push({
      cid: "evt2",
      filename: "Evt2.jpg",
      contentType: "image/jpeg",
      data: fs.readFileSync(POSTER_FILE),
    });
  }

  return { subject, text, html, images };
}

module.exports = { buildThankYouEmail };
