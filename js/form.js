// Client-side validation only. Sending is not enabled yet (no fax provider/backend).
(function () {
  var MAX_BYTES = 10 * 1024 * 1024;
  var form = document.getElementById("fax-form");
  var pdf = document.getElementById("pdf");
  var name = document.getElementById("name");
  var number = document.getElementById("number");
  var status = document.getElementById("status");

  function setError(id, msg) { document.getElementById(id + "-error").textContent = msg || ""; }

  function validate() {
    var ok = true;

    var file = pdf.files[0];
    var pdfMsg = "";
    if (!file) pdfMsg = "Choose a PDF to send.";
    else if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) pdfMsg = "File must be a PDF.";
    else if (file.size > MAX_BYTES) pdfMsg = "File is larger than 10 MB.";
    setError("pdf", pdfMsg); if (pdfMsg) ok = false;

    var nameMsg = name.value.trim() ? "" : "Enter the recipient's name.";
    setError("name", nameMsg); if (nameMsg) ok = false;

    // E.164-style: optional +, then 8-15 digits once separators are stripped.
    var digits = number.value.replace(/[\s().-]/g, "");
    var numMsg = /^\+?\d{8,15}$/.test(digits) ? "" : "Enter a valid fax number with country code.";
    setError("number", numMsg); if (numMsg) ok = false;

    return ok;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    status.textContent = "";
    if (!validate()) return;
    status.textContent = "Looks good, but sending isn't enabled yet. Check back soon.";
  });
})();
