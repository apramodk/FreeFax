// Shows the fund balance: live from the API when configured, otherwise from data/wallet.json.
(function () {
  var out = document.getElementById("wallet-amount");
  var cfg = window.SITE_CONFIG || {};

  function show(balance, currency, updated) {
    out.textContent = new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(balance);
    if (updated) out.parentElement.title += " (updated " + updated + ")";
  }
  function fromFile() {
    return fetch("data/wallet.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (w) { show(w.balance, w.currency, w.updated); });
  }

  var live = cfg.API_URL
    ? fetch(cfg.API_URL + "/balance").then(function (r) { return r.json(); })
        .then(function (b) { if (!b.ok) throw new Error("balance"); show(b.balance, b.currency); })
    : Promise.reject();
  live.catch(fromFile).catch(function () { out.textContent = "n/a"; });
})();
