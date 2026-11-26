// Thank-you emails sent to each new volunteer and each new artist.
const fs = require("fs");
const path = require("path");

const POSTER_FILE = path.join(__dirname, "public", "img", "Evt2.jpg");
const CONCERT_FILE = path.join(__dirname, "public", "img", "SamuelConcert1.jpg");

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
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
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
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
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

// Thanks a donor for a gift. Not a tax receipt; the amount and date are shown as recorded.
function buildDonationThankYouEmail({ name, amountCents, donatedOn }) {
  const amount = "$" + (amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subject = "Thank you for your donation to Worship On The Mountain";
  const dateText = donatedOn ? ` on ${donatedOn}` : "";
  const proceeds =
    "All proceeds will fund the event. Any remaining funds will go to help mental health in Tennessee.";

  const text = [
    name ? `Dear ${name},` : "Dear friend,",
    "",
    `Thank you for your generous gift of ${amount} to Worship On The Mountain${dateText}.`,
    "",
    proceeds,
    "",
    "If you have any questions, please contact Samuel Wright Jr.:",
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
    "",
    "He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!",
    "",
    "With gratitude,",
    "Worship On The Mountain",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 16px;color:#1b2a4a;font-size:26px;text-align:center;">Thank you for your gift!</h1>
      <p>${name ? `Dear ${escapeHtml(name)},` : "Dear friend,"}</p>
      <p>Thank you for your generous gift of <strong>${escapeHtml(amount)}</strong> to <strong>Worship On The Mountain</strong>${escapeHtml(dateText)}.</p>
      <div style="border-left:4px solid #c9a227;background:#fbf7ee;padding:12px 16px;margin:16px 0;">
        <p style="margin:0;">${escapeHtml(proceeds)}</p>
      </div>
      <p>If you have any questions, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
      <p style="font-style:italic;color:#1b2a4a;">He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!</p>
      <p style="margin-bottom:0;">With gratitude,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  return { subject, text, html, images: [] };
}

const ARTIST_ROLE_TEXT = {
  perform: "perform",
  help: "help out",
  both: "perform and help out",
};

// Keeps line breaks the artist typed when showing their text in the HTML email.
function htmlLines(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function buildArtistThankYouEmail({ name, role, services, needs }) {
  const roleText = ARTIST_ROLE_TEXT[role] || "take part";
  const subject = "Thank you for sharing your gifts with Worship On The Mountain!";

  const text = [
    `Dear ${name},`,
    "",
    `Thank you for offering to ${roleText} at Worship On The Mountain! Every song, every voice and every helping hand is a gift, and we are truly grateful you want to share yours with us.`,
    "",
    "Here is what you sent us:",
    `You would like to: ${roleText}`,
    `Services offered: ${services}`,
    needs ? `Your needs: ${needs}` : "",
    "",
    "What happens next:",
    "- Our organizers will read your submission and pray over the lineup.",
    "- We will reach out to you at this email address about scheduling and anything you need.",
    "- Once approved, you will be listed on the Artists page of our website.",
    "",
    "The exact date is still to be determined. We will be in touch with more details as they are confirmed.",
    "",
    "If you have any questions or need more information, please contact Samuel Wright Jr.:",
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
    "",
    '"Sing unto him a new song; play skilfully with a loud noise." (Psalm 33:3)',
    "",
    "He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!",
    "",
    "With gratitude and blessings,",
    "Worship On The Mountain",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 6px;color:#1b2a4a;font-size:26px;text-align:center;">Thank you for sharing your gifts!</h1>
      <p style="margin:0 0 16px;text-align:center;color:#8a6d0f;font-style:italic;">Worship On The Mountain</p>
      <p>Dear ${escapeHtml(name)},</p>
      <p>Thank you for offering to <strong>${escapeHtml(roleText)}</strong> at <strong>Worship On The Mountain</strong>! Every song, every voice and every helping hand is a gift, and we are truly grateful you want to share yours with us.</p>
      <div style="border-left:4px solid #c9a227;background:#fbf7ee;padding:12px 16px;margin:16px 0;">
        <p style="margin:0 0 6px;"><strong>You would like to:</strong> ${escapeHtml(roleText)}</p>
        <p style="margin:0 0 6px;"><strong>Services offered:</strong> ${htmlLines(services)}</p>
        ${needs ? `<p style="margin:0;"><strong>Your needs:</strong> ${htmlLines(needs)}</p>` : ""}
      </div>
      <h2 style="margin:20px 0 8px;color:#1b2a4a;font-size:20px;">What happens next</h2>
      <ul style="margin:0 0 16px;padding-left:20px;">
        <li style="margin-bottom:6px;">Our organizers will read your submission and pray over the lineup.</li>
        <li style="margin-bottom:6px;">We will reach out to you at this email address about scheduling and anything you need.</li>
        <li>Once approved, you will be listed on the Artists page of our website.</li>
      </ul>
      <p><strong>Date:</strong> Exact date to be determined. We will be in touch with more details as they are confirmed.</p>
      <img src="cid:concert" alt="Samuel Wright Jr. performing in concert" style="display:block;max-width:100%;height:auto;margin:20px auto;border:6px solid #ffffff;outline:1px solid #c9a227;">
      <p style="text-align:center;font-style:italic;color:#1b2a4a;margin:0 0 4px;">&ldquo;Sing unto him a new song; play skilfully with a loud noise.&rdquo;</p>
      <p style="text-align:center;color:#8a6d0f;margin:0 0 20px;">Psalm 33:3</p>
      <p>If you have any questions or need more information, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
      <p style="font-style:italic;color:#1b2a4a;">He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!</p>
      <p style="margin-bottom:0;">With gratitude and blessings,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  const images = [];
  if (fs.existsSync(CONCERT_FILE)) {
    images.push({
      cid: "concert",
      filename: "SamuelConcert1.jpg",
      contentType: "image/jpeg",
      data: fs.readFileSync(CONCERT_FILE),
    });
  }

  return { subject, text, html, images };
}

// Sent the first time an admin approves an artist, following up on "Once approved, you will be listed".
// siteUrl is optional; without it the email names the Artists page without a link.
function buildArtistApprovalEmail({ name, role, siteUrl }) {
  const roleText = ARTIST_ROLE_TEXT[role] || "take part";
  const artistsUrl = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/artists.html` : "";
  const subject = "You're approved! Welcome to the Worship On The Mountain artists";

  const text = [
    `Dear ${name},`,
    "",
    "Wonderful news! Your submission has been reviewed and approved. You are now listed on the Artists page of our website.",
    artistsUrl ? `See your listing: ${artistsUrl}` : "",
    "",
    `Thank you for offering to ${roleText}. We are honored to have you with us as we gather to worship on the mountain.`,
    "",
    "What happens next:",
    "- We will reach out to you at this email address about scheduling, set times and anything you need.",
    "- If you need to update your listing, just reply or contact Samuel Wright Jr. below.",
    "",
    "The exact date is still to be determined. We will be in touch with more details as they are confirmed.",
    "",
    "If you have any questions or need more information, please contact Samuel Wright Jr.:",
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
    "",
    '"Let everything that hath breath praise the LORD. Praise ye the LORD." (Psalm 150:6)',
    "",
    "He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!",
    "",
    "With gratitude and blessings,",
    "Worship On The Mountain",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 6px;color:#1b2a4a;font-size:26px;text-align:center;">You're approved!</h1>
      <p style="margin:0 0 16px;text-align:center;color:#8a6d0f;font-style:italic;">Welcome to the Worship On The Mountain artists</p>
      <p>Dear ${escapeHtml(name)},</p>
      <p>Wonderful news! Your submission has been reviewed and <strong>approved</strong>. You are now listed on the Artists page of our website.</p>
      ${
        artistsUrl
          ? `<p style="text-align:center;margin:20px 0;"><a href="${escapeHtml(artistsUrl)}" style="display:inline-block;padding:12px 22px;background:#1b2a4a;color:#f3e3a3;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;border:1px solid #c9a227;">See your listing</a></p>`
          : ""
      }
      <p>Thank you for offering to <strong>${escapeHtml(roleText)}</strong>. We are honored to have you with us as we gather to worship on the mountain.</p>
      <h2 style="margin:20px 0 8px;color:#1b2a4a;font-size:20px;">What happens next</h2>
      <ul style="margin:0 0 16px;padding-left:20px;">
        <li style="margin-bottom:6px;">We will reach out to you at this email address about scheduling, set times and anything you need.</li>
        <li>If you need to update your listing, just reply or contact Samuel Wright Jr. below.</li>
      </ul>
      <p><strong>Date:</strong> Exact date to be determined. We will be in touch with more details as they are confirmed.</p>
      <img src="cid:concert" alt="Samuel Wright Jr. performing in concert" style="display:block;max-width:100%;height:auto;margin:20px auto;border:6px solid #ffffff;outline:1px solid #c9a227;">
      <p style="text-align:center;font-style:italic;color:#1b2a4a;margin:0 0 4px;">&ldquo;Let everything that hath breath praise the LORD. Praise ye the LORD.&rdquo;</p>
      <p style="text-align:center;color:#8a6d0f;margin:0 0 20px;">Psalm 150:6</p>
      <p>If you have any questions or need more information, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
      <p style="font-style:italic;color:#1b2a4a;">He said He can and will move mountains for each one of us. Thank you for helping us shake one for Him!</p>
      <p style="margin-bottom:0;">With gratitude and blessings,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  const images = [];
  if (fs.existsSync(CONCERT_FILE)) {
    images.push({
      cid: "concert",
      filename: "SamuelConcert1.jpg",
      contentType: "image/jpeg",
      data: fs.readFileSync(CONCERT_FILE),
    });
  }

  return { subject, text, html, images };
}

// Sent when an artist is added to the performance lineup, or removed from it.
// performance: { title, time, description }; any of them may be blank.
function buildLineupEmail({ name, added, performance, siteUrl }) {
  const artistsUrl = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/artists.html` : "";
  const title = performance.title || "";
  const time = performance.time || "";
  const description = performance.description || "";
  const subject = added
    ? "You're on the lineup for Worship On The Mountain!"
    : "An update about your Worship On The Mountain performance";
  const heading = added ? "You're on the lineup!" : "A change to the lineup";
  const intro = added
    ? "Praise God! You have been added to the performance lineup for Worship On The Mountain. We can't wait to worship alongside you."
    : "We wanted to let you know that the performance below has been removed from the Worship On The Mountain lineup.";
  const followUp = added
    ? [
        time
          ? "Please hold this time. We will be in touch with any changes and the details you need for the day."
          : "Your set time has not been scheduled yet. We will be in touch with the time and the details you need for the day.",
        "If anything changes on your side, or you need anything for your set, please let us know as soon as you can.",
      ]
    : [
        "This may be because the schedule is still being worked out. It does not change how grateful we are for you, and we will reach out if there is a new spot for you.",
        "If you have any questions about this change, please don't hesitate to contact us.",
      ];
  const verse = added
    ? { text: "Sing unto him a new song; play skilfully with a loud noise.", ref: "Psalm 33:3" }
    : { text: "And we know that all things work together for good to them that love God.", ref: "Romans 8:28" };

  const details = [
    ["Performance", title],
    ["Time", time || (added ? "To be scheduled" : "")],
    ["About", description],
  ].filter(([, value]) => value);

  const text = [
    `Dear ${name},`,
    "",
    intro,
    "",
    ...(details.length ? details.map(([label, value]) => `${label}: ${value}`) : []),
    details.length ? "" : "",
    ...followUp.flatMap((line) => [line, ""]),
    added && artistsUrl ? `See the lineup: ${artistsUrl}` : "",
    "",
    "The exact date of the event is still to be determined. We will be in touch with more details as they are confirmed.",
    "",
    "If you have any questions or need more information, please contact Samuel Wright Jr.:",
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
    "",
    `"${verse.text}" (${verse.ref})`,
    "",
    "With gratitude and blessings,",
    "Worship On The Mountain",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 6px;color:#1b2a4a;font-size:26px;text-align:center;">${heading}</h1>
      <p style="margin:0 0 16px;text-align:center;color:#8a6d0f;font-style:italic;">Worship On The Mountain</p>
      <p>Dear ${escapeHtml(name)},</p>
      <p>${intro}</p>
      ${
        details.length
          ? `<div style="border-left:4px solid #c9a227;background:#fbf7ee;padding:12px 16px;margin:16px 0;">
        ${details
          .map(([label, value]) => `<p style="margin:0 0 6px;"><strong>${label}:</strong> ${htmlLines(value)}</p>`)
          .join("\n        ")}
      </div>`
          : ""
      }
      ${followUp.map((line) => `<p>${line}</p>`).join("\n      ")}
      ${
        added && artistsUrl
          ? `<p style="text-align:center;margin:20px 0;"><a href="${escapeHtml(artistsUrl)}" style="display:inline-block;padding:12px 22px;background:#1b2a4a;color:#f3e3a3;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;border:1px solid #c9a227;">See the lineup</a></p>`
          : ""
      }
      <p><strong>Date:</strong> Exact date to be determined. We will be in touch with more details as they are confirmed.</p>
      ${
        added
          ? `<img src="cid:concert" alt="Samuel Wright Jr. performing in concert" style="display:block;max-width:100%;height:auto;margin:20px auto;border:6px solid #ffffff;outline:1px solid #c9a227;">`
          : ""
      }
      <p style="text-align:center;font-style:italic;color:#1b2a4a;margin:0 0 4px;">&ldquo;${verse.text}&rdquo;</p>
      <p style="text-align:center;color:#8a6d0f;margin:0 0 20px;">${verse.ref}</p>
      <p>If you have any questions or need more information, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
      <p style="margin-bottom:0;">With gratitude and blessings,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  const images = [];
  if (added && fs.existsSync(CONCERT_FILE)) {
    images.push({
      cid: "concert",
      filename: "SamuelConcert1.jpg",
      contentType: "image/jpeg",
      data: fs.readFileSync(CONCERT_FILE),
    });
  }

  return { subject, text, html, images };
}

// Sent to a linked artist when the time of their performance changes.
// previousTime or performance.time may be blank (not scheduled yet).
function buildTimeChangeEmail({ name, performance, previousTime, siteUrl }) {
  const artistsUrl = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/artists.html` : "";
  const newTime = performance.time || "";
  const subject = newTime
    ? `Your performance time has changed: ${newTime}`
    : "Your performance time has changed";
  const intro = newTime
    ? "We wanted to let you know that the time of your performance at Worship On The Mountain has changed."
    : "We wanted to let you know that the time of your performance at Worship On The Mountain is being rescheduled. A new time has not been set yet.";
  const followUp = newTime
    ? "Please make a note of the new time. If you can no longer make it, or the new time causes any trouble, please let us know as soon as you can so we can work it out together."
    : "We will be in touch with your new time as soon as it is set. If you have any times that work best for you, please let us know.";

  const details = [
    ["Performance", performance.title || ""],
    ["Previous time", previousTime || "Not scheduled"],
    ["New time", newTime || "To be scheduled"],
  ].filter(([, value]) => value);

  const text = [
    `Dear ${name},`,
    "",
    intro,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    followUp,
    "",
    artistsUrl ? `See the lineup: ${artistsUrl}` : "",
    "",
    "The exact date of the event is still to be determined. We will be in touch with more details as they are confirmed.",
    "",
    "If you have any questions or need more information, please contact Samuel Wright Jr.:",
    "Email: worshiponthemountain@outlook.com",
    "Phone: 931-655-9090",
    "",
    '"To every thing there is a season, and a time to every purpose under the heaven." (Ecclesiastes 3:1)',
    "",
    "Thank you for your flexibility and your heart for this event.",
    "",
    "With gratitude and blessings,",
    "Worship On The Mountain",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#fbf7ee;font-family:Georgia,'Times New Roman',serif;color:#2a2a2a;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #c9a227;border-top:6px solid #c9a227;padding:24px;">
      <h1 style="margin:0 0 6px;color:#1b2a4a;font-size:26px;text-align:center;">Your performance time has changed</h1>
      <p style="margin:0 0 16px;text-align:center;color:#8a6d0f;font-style:italic;">Worship On The Mountain</p>
      <p>Dear ${escapeHtml(name)},</p>
      <p>${intro}</p>
      <div style="border-left:4px solid #c9a227;background:#fbf7ee;padding:12px 16px;margin:16px 0;">
        ${details
          .map(([label, value]) => {
            const isOld = label === "Previous time";
            const isNew = label === "New time";
            const style = isOld ? "color:#777;text-decoration:line-through;" : isNew ? "color:#1b2a4a;font-weight:bold;" : "";
            return `<p style="margin:0 0 6px;"><strong>${label}:</strong> <span style="${style}">${htmlLines(value)}</span></p>`;
          })
          .join("\n        ")}
      </div>
      <p>${followUp}</p>
      ${
        artistsUrl
          ? `<p style="text-align:center;margin:20px 0;"><a href="${escapeHtml(artistsUrl)}" style="display:inline-block;padding:12px 22px;background:#1b2a4a;color:#f3e3a3;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;border:1px solid #c9a227;">See the lineup</a></p>`
          : ""
      }
      <p><strong>Date:</strong> Exact date to be determined. We will be in touch with more details as they are confirmed.</p>
      <p style="text-align:center;font-style:italic;color:#1b2a4a;margin:20px 0 4px;">&ldquo;To every thing there is a season, and a time to every purpose under the heaven.&rdquo;</p>
      <p style="text-align:center;color:#8a6d0f;margin:0 0 20px;">Ecclesiastes 3:1</p>
      <p>If you have any questions or need more information, please contact <strong>Samuel Wright Jr.</strong>:</p>
      <p style="margin:0 0 4px;">Email: <a href="mailto:worshiponthemountain@outlook.com" style="color:#2c4170;">worshiponthemountain@outlook.com</a></p>
      <p style="margin:0 0 16px;">Phone: <a href="tel:9316559090" style="color:#2c4170;">931-655-9090</a></p>
      <p style="font-style:italic;color:#1b2a4a;">Thank you for your flexibility and your heart for this event.</p>
      <p style="margin-bottom:0;">With gratitude and blessings,<br><strong>Worship On The Mountain</strong></p>
    </div>
  </body>
</html>`;

  return { subject, text, html, images: [] };
}

module.exports = {
  buildThankYouEmail,
  buildDonationThankYouEmail,
  buildArtistThankYouEmail,
  buildArtistApprovalEmail,
  buildLineupEmail,
  buildTimeChangeEmail,
};
