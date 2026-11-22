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

  // ---- Hero: spoken sentences and how they get rewritten, on a loop -------
  var heroDemo = document.getElementById("heroDemo");
  var heard = document.getElementById("heardText");
  var pasted = document.getElementById("pasteText");
  var pillLabel = document.getElementById("pillLabel");
  if (heroDemo && heard && pasted && pillLabel && !reduce) {
    // The first pair is already in the markup.
    var examples = [
      ["um so I think we should uh ship the release tonight and like notify the team",
       "I think we should ship the release tonight and notify the team."],
      ["can we move the sync to Thursday no wait Friday at ten",
       "Can we move the sync to Friday at 10?"],
      ["hey Sarah just wanted to say uh thanks for the quick review",
       "Hey Sarah, just wanted to say thanks for the quick review!"],
      ["the the main issue is that the cache isn't you know being cleared",
       "The main issue is that the cache isn't being cleared."],
      ["remind me to email the design team um about the new logo tomorrow",
       "Remind me to email the design team about the new logo tomorrow."]
    ];
    var wait = function (ms) {
      return new Promise(function (done) { setTimeout(done, ms); });
    };
    var play = async function (example) {
      heroDemo.classList.remove("rewriting", "pasted");
      pillLabel.textContent = "Listening…";
      pasted.classList.add("swapping"); // the card waits for the new text
      var words = example[0].split(" ");
      for (var i = 1; i <= words.length; i++) {
        heard.textContent = words.slice(0, i).join(" ");
        await wait(150);
      }
      await wait(500);
      heroDemo.classList.add("rewriting");
      pillLabel.textContent = "Rewriting…";
      await wait(800);
      pasted.textContent = example[1];
      pasted.classList.remove("swapping");
      heroDemo.classList.replace("rewriting", "pasted");
      pillLabel.textContent = "Pasted";
      await wait(3000);
    };
    (async function () {
      await wait(3000);
      for (var n = 1; ; n = (n + 1) % examples.length) await play(examples[n]);
    })();
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
