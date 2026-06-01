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

  // ---- Pointer-following glow in the hero stage --------------------------
  var heroStage = document.getElementById("heroStage");
  if (heroStage && !reduce) {
    heroStage.addEventListener("pointermove", function (e) {
      var r = heroStage.getBoundingClientRect();
      heroStage.style.setProperty("--gx", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
      heroStage.style.setProperty("--gy", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
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

  // ---- "Try it" live dictation demo (types the transcript) ---------------
  var tryBtn = document.getElementById("tryBtn");
  var demoOut = document.getElementById("demoOut");
  var demo = tryBtn ? tryBtn.closest(".hotkey-demo") : null;
  var typing = false;
  if (tryBtn && demoOut) {
    tryBtn.addEventListener("click", function () {
      if (typing) return;
      typing = true;
      var text = demoOut.getAttribute("data-text") || demoOut.textContent;
      demoOut.textContent = "";
      demoOut.classList.add("typing");
      if (demo) demo.classList.add("recording");
      tryBtn.disabled = true;
      var i = 0;
      var step = function () {
        demoOut.textContent = text.slice(0, i + 1);
        i++;
        if (i < text.length) {
          setTimeout(step, 42);
        } else {
          demoOut.classList.remove("typing");
          if (demo) demo.classList.remove("recording");
          tryBtn.disabled = false;
          typing = false;
        }
      };
      // brief "listening" beat before the words land
      setTimeout(step, 380);
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
