// Renders each ad slot from window.ADS_CONFIG (see ads.config.js).
(function () {
  var configs = window.ADS_CONFIG || [];
  configs.forEach(function (cfg) {
    var el = document.querySelector('.ad[data-slot="' + cfg.slot + '"]');
    if (!el) return;

    if (!cfg.id) {
      var ph = document.createElement("div");
      ph.className = "ad-placeholder";
      ph.style.width = cfg.width + "px";
      ph.style.height = cfg.height + "px";
      ph.textContent = "Ad slot " + cfg.slot + " (set id in ads.config.js)";
      el.appendChild(ph);
      return;
    }

    var frame = document.createElement("iframe");
    frame.setAttribute("data-aa", cfg.id);
    frame.src = "//acceptable.a-ads.com/" + encodeURIComponent(cfg.id);
    frame.width = cfg.width;
    frame.height = cfg.height;
    frame.title = "Advertisement";
    frame.loading = "lazy";
    el.appendChild(frame);
  });
})();
