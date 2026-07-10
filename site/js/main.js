/* referat — landningssida. Vanilla JS, inga beroenden. */
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "referat-theme";

  /* ---------- Tema-växling ---------- */
  var toggle = document.getElementById("theme-toggle");

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function syncToggle() {
    if (!toggle) return;
    var isDark = currentTheme() === "dark";
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute(
      "aria-label",
      isDark ? "Växla till ljust läge" : "Växla till mörkt läge"
    );
  }

  function setTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {}
    syncToggle();
  }

  syncToggle();

  if (toggle) {
    toggle.addEventListener("click", function () {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  /* Följ systemtema om användaren inte gjort ett eget val */
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystemChange = function (e) {
      var saved = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch (err) {}
      if (!saved) {
        root.setAttribute("data-theme", e.matches ? "dark" : "light");
        syncToggle();
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  } catch (e) {}

  /* ---------- Nav: skugga/kant vid scroll ---------- */
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      if (window.scrollY > 8) nav.classList.add("is-scrolled");
      else nav.classList.remove("is-scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Scroll-reveal ---------- */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!("IntersectionObserver" in window) || prefersReduced) {
    reveals.forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---------- Placeholder-nedladdning ---------- */
  var downloadToastTimer = null;

  function hideDownloadToast() {
    var toast = document.getElementById("download-toast");
    if (toast) toast.classList.remove("is-visible");
  }

  function showDownloadToast() {
    var toast = document.getElementById("download-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "download-toast";
      toast.className = "download-toast";
      toast.setAttribute("role", "status");
      toast.innerHTML =
        '<span class="download-toast__dot" aria-hidden="true"></span>' +
        "<span>Nedladdningen öppnas snart — version 0.1 är på väg.</span>";
      document.body.appendChild(toast);
      toast.addEventListener("click", hideDownloadToast);
    }
    if (downloadToastTimer) clearTimeout(downloadToastTimer);
    // Next frame so the fade-in transition runs from the hidden state.
    requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });
    downloadToastTimer = setTimeout(hideDownloadToast, 4500);
  }

  var downloads = document.querySelectorAll('[data-placeholder="download"]');
  Array.prototype.forEach.call(downloads, function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      // Installer-länken kopplas in senare (version 0.1).
      showDownloadToast();
    });
  });
})();
