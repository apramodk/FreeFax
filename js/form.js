// Validates the fax form and sends it through the CrowdFax API (see worker/).
// While SITE_CONFIG.API_URL is empty, sending is disabled and the form says so.
(function () {
  var MAX_BYTES = 10 * 1024 * 1024;
  var cfg = window.SITE_CONFIG || {};
  var form = document.getElementById("fax-form");
  var pdf = document.getElementById("pdf");
  var number = document.getElementById("number");
  var status = document.getElementById("status");
  var submit = form.querySelector("button[type=submit]");
  var turnstileBox = document.getElementById("turnstile");
  var turnstileId = null;

  function setError(id, msg) { document.getElementById(id + "-error").textContent = msg || ""; }
  function say(msg) { status.textContent = msg; }

  function validate() {
    var ok = true;
    var file = pdf.files[0];
    var pdfMsg = "";
    if (!file) pdfMsg = "Choose a PDF to send.";
    else if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) pdfMsg = "File must be a PDF.";
    else if (file.size > MAX_BYTES) pdfMsg = "File is larger than 10 MB.";
    setError("pdf", pdfMsg); if (pdfMsg) ok = false;

    // E.164-style: optional +, then 8-15 digits once separators are stripped.
    var digits = number.value.replace(/[\s().-]/g, "");
    var numMsg = /^\+?\d{8,15}$/.test(digits) ? "" : "Enter a valid fax number with country code.";
    setError("number", numMsg); if (numMsg) ok = false;
    return ok;
  }

  function loadTurnstile() {
    if (!cfg.API_URL || !cfg.TURNSTILE_SITEKEY || !turnstileBox) return;
    turnstileBox.hidden = false;
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = function () {
      turnstileId = window.turnstile.render(turnstileBox, { sitekey: cfg.TURNSTILE_SITEKEY });
    };
    document.head.appendChild(s);
  }

  var LABELS = {
    queued: "Queued...", "media.processed": "Preparing your document...",
    originated: "Dialing...", sending: "Sending...", delivered: "Delivered. Thank you for using CrowdFax!"
  };

  function poll(id, tries) {
    if (tries > 45) { say("Still working. Delivery can take a few minutes; we can't show the result here."); done(); return; }
    setTimeout(function () {
      fetch(cfg.API_URL + "/status?id=" + encodeURIComponent(id))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.status === "delivered") { say(LABELS.delivered); done(); }
          else if (d.failed) { say("Delivery failed. Check the number and try again."); done(); }
          else { say(LABELS[d.status] || "Sending..."); poll(id, tries + 1); }
        })
        .catch(function () { poll(id, tries + 1); });
    }, 4000);
  }

  function done() { submit.disabled = false; if (turnstileId !== null) window.turnstile.reset(turnstileId); }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    say("");
    if (!validate()) return;
    if (!cfg.API_URL) { say("Looks good, but sending isn't enabled yet. Check back soon."); return; }

    var token = turnstileId !== null ? window.turnstile.getResponse(turnstileId) : "";
    if (!token) { say("Please complete the human check first."); return; }

    // The recipient name is never sent; only the PDF and the number leave the browser.
    var fd = new FormData();
    fd.set("pdf", pdf.files[0]);
    fd.set("number", number.value);
    fd.set("cf-turnstile-response", token);

    submit.disabled = true;
    say("Uploading...");
    fetch(cfg.API_URL + "/send", { method: "POST", body: fd })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) { say(res.d.message || "Could not send. Please try again."); done(); return; }
        say(LABELS.queued);
        poll(res.d.id, 0);
      })
      .catch(function () { say("Network problem. Please try again."); done(); });
  });

  loadTurnstile();
})();
