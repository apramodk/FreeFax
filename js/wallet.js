// Shows the crowd-funded balance from data/wallet.json.
(function () {
  var out = document.getElementById("wallet-amount");
  fetch("data/wallet.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (w) {
      out.textContent = new Intl.NumberFormat("en-US", {
        style: "currency", currency: w.currency || "USD"
      }).format(w.balance);
      if (w.updated) out.parentElement.title += " (updated " + w.updated + ")";
    })
    .catch(function () { out.textContent = "n/a"; });
})();
