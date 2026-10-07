// Detects ad blockers and disables the fax form until they are turned off.
// Client-side only: it deters casual use, it is not a security control.
(function () {
  var AD_PROBE = "https://acceptable.a-ads.com/2457703";
  var PROBE_TIMEOUT_MS = 4000;
  var form = document.getElementById("fax-form");
  var notice = document.getElementById("adblock-notice");
  var recheck = document.getElementById("adblock-recheck");
  var bait = document.getElementById("ad-bait");

  // Cosmetic blockers hide elements whose class names look like ads.
  function baitHidden() {
    if (!bait) return false;
    var cs = window.getComputedStyle(bait);
    return bait.offsetHeight === 0 || cs.display === "none" || cs.visibility === "hidden";
  }

  // Network blockers reject the request quickly. A timeout is treated as "not blocked"
  // so an A-ADS outage doesn't lock every visitor out.
  function probeBlocked() {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, PROBE_TIMEOUT_MS);
    return fetch(AD_PROBE, { mode: "no-cors", cache: "no-store", signal: ctl.signal })
      .then(function () { clearTimeout(timer); return false; })
      .catch(function (err) { clearTimeout(timer); return !(err && err.name === "AbortError"); });
  }

  function setBlocked(blocked) {
    notice.hidden = !blocked;
    form.querySelectorAll("input, button").forEach(function (el) { el.disabled = blocked; });
    form.classList.toggle("is-locked", blocked);
  }

  function check() {
    if (baitHidden()) { setBlocked(true); return; }
    probeBlocked().then(setBlocked);
  }

  recheck.addEventListener("click", check);
  window.addEventListener("focus", check);
  if (document.readyState === "complete") check();
  else window.addEventListener("load", check);
})();
