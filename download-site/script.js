// Showroom interactions — plain vanilla JS, no build step (Vercel serves this
// folder statically). Progressive enhancement: everything degrades to a static,
// fully-readable page if JS is off.
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Nav blur + scroll-progress bar ------------------------------------
  var nav = document.getElementById("nav");
  var progress = document.getElementById("scrollProgress");
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (nav) nav.classList.toggle("scrolled", y > 24);
    if (progress) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    }
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // ---- Scroll-reveal ------------------------------------------------------
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("in-view");
    });
  }

  // ---- 3D pointer-tilt on mockup cards -----------------------------------
  if (!reduce) {
    document.querySelectorAll(".tilt").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        if (e.pointerType === "touch") return;
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          "rotateX(" + (-py * 6).toFixed(2) + "deg) rotateY(" + (px * 6).toFixed(2) + "deg)";
      });
      card.addEventListener("pointerleave", function () {
        card.style.transform = "";
      });
    });
  }

  // ---- "Clean it up" before/after reveal ---------------------------------
  var cleanBtn = document.getElementById("cleanBtn");
  var rewriteCard = document.getElementById("rewriteCard");
  if (cleanBtn && rewriteCard) {
    rewriteCard.classList.add("interactive"); // collapse the cleaned row (JS only)
    cleanBtn.addEventListener("click", function () {
      var on = rewriteCard.classList.toggle("cleaned");
      cleanBtn.textContent = on ? "Reset" : "Clean it up ✨";
    });
  }
})();
