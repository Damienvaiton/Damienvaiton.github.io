// Ciel étoilé, horloge de la nuit, apparitions, aperçus des projets.
(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;
  root.classList.add("js");

  window.addEventListener("load", function () {
    requestAnimationFrame(function () {
      root.classList.add("loaded");
    });
  });
  // Filet de sécurité si "load" tarde (polices, images)
  setTimeout(function () {
    root.classList.add("loaded");
  }, 1500);

  // ---------- Ciel étoilé ----------
  var canvas = document.querySelector(".stars");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d");
    var stars = [];
    var shooting = null;
    var nextShot = 4000;
    var w, h, dpr;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = Math.round((w * h) / 9000);
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.1 + 0.2,
          a: Math.random() * 0.6 + 0.2,
          s: Math.random() * 0.002 + 0.0005,
          p: Math.random() * Math.PI * 2,
          gold: Math.random() < 0.07,
        });
      }
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var alpha = reduced ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * s.s + s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.gold ? "rgba(236,211,148," + alpha + ")" : "rgba(236,233,247," + alpha + ")";
        ctx.fill();
      }
      if (shooting) {
        var k = (t - shooting.t0) / shooting.d;
        if (k >= 1) {
          shooting = null;
        } else {
          var x = shooting.x + shooting.dx * k;
          var y = shooting.y + shooting.dy * k;
          var g = ctx.createLinearGradient(x, y, x - shooting.dx * 0.18, y - shooting.dy * 0.18);
          var fade = Math.sin(k * Math.PI);
          g.addColorStop(0, "rgba(255,244,207," + fade + ")");
          g.addColorStop(1, "rgba(255,244,207,0)");
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - shooting.dx * 0.18, y - shooting.dy * 0.18);
          ctx.stroke();
        }
      } else if (!reduced && t > nextShot) {
        shooting = {
          t0: t,
          d: 1100,
          x: Math.random() * w * 0.7 + w * 0.2,
          y: Math.random() * h * 0.35,
          dx: -(Math.random() * 300 + 250),
          dy: Math.random() * 120 + 90,
        };
        nextShot = t + 7000 + Math.random() * 9000;
      }
      if (!reduced) requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(draw);
  }

  // ---------- Halo qui suit la souris ----------
  var glow = document.querySelector(".glow");
  if (glow && finePointer && !reduced) {
    var gx = 0,
      gy = 0,
      tx = 0,
      ty = 0;
    window.addEventListener("pointermove", function (e) {
      tx = e.clientX;
      ty = e.clientY;
      glow.classList.add("on");
    });
    (function loop() {
      gx += (tx - gx) * 0.08;
      gy += (ty - gy) * 0.08;
      glow.style.transform = "translate(" + gx + "px," + gy + "px)";
      requestAnimationFrame(loop);
    })();
  }

  // ---------- Nav : fond au scroll + menu mobile ----------
  var nav = document.querySelector(".nav");
  var menuBtn = document.querySelector(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open);
    });
    nav.querySelectorAll(".nav-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---------- Horloge : 00:00 en haut, l'aube en bas ----------
  var clock = document.querySelector(".clock");
  var clockText = clock && clock.querySelector("span");
  var timed = Array.prototype.slice.call(document.querySelectorAll("[data-time]"));
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  function minutesOf(str) {
    var p = str.split(":");
    return +p[0] * 60 + +p[1];
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle("scrolled", y > 30);
    if (!timed.length) return;

    // Interpolation entre les sections (chacune porte son heure)
    var probe = y + window.innerHeight * 0.45;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var points = timed.map(function (el) {
      return { top: el.getBoundingClientRect().top + y, m: minutesOf(el.dataset.time) };
    });
    // En haut de page, il est minuit pile
    points[0].top = Math.max(points[0].top, window.innerHeight * 0.45);
    var last = points[points.length - 1];
    // La dernière section atteint son heure quand on arrive en bas de page
    last.top = Math.min(last.top, max + window.innerHeight * 0.45);
    var m = points[0].m;
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i],
        b = points[i + 1];
      if (probe >= a.top && probe < b.top) {
        m = a.m + ((probe - a.top) / (b.top - a.top)) * (b.m - a.m);
        break;
      }
      if (probe >= b.top) m = b.m;
    }
    m = Math.round(m);
    if (clockText) clockText.textContent = pad(Math.floor(m / 60)) + ":" + pad(m % 60);

    var dawn = Math.max(0, Math.min(1, (m - 270) / 90));
    root.style.setProperty("--dawn", dawn.toFixed(3));
    if (clock) clock.classList.toggle("dawn-on", dawn > 0.5);

    // Lien actif
    var current = null;
    timed.forEach(function (el) {
      if (el.id && el.getBoundingClientRect().top < window.innerHeight * 0.5) current = el.id;
    });
    navLinks.forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#" + current);
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // ---------- Titres : mots qui montent ----------
  document.querySelectorAll(".split").forEach(function (el) {
    var i = 0;
    (function wrap(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
            } else {
              var w = document.createElement("span");
              w.className = "w";
              var inner = document.createElement("span");
              inner.style.setProperty("--i", i++);
              inner.textContent = part;
              w.appendChild(inner);
              frag.appendChild(w);
            }
          });
          child.parentNode.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          // Garde les <em class="gold"> : on enveloppe l'élément entier
          var w2 = document.createElement("span");
          w2.className = "w";
          var inner2 = document.createElement("span");
          inner2.style.setProperty("--i", i++);
          child.parentNode.replaceChild(w2, child);
          inner2.appendChild(child);
          w2.appendChild(inner2);
        }
      });
    })(el);
  });

  // ---------- Apparitions au scroll ----------
  var observed = document.querySelectorAll(".reveal, .split");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    observed.forEach(function (el) {
      io.observe(el);
    });
  } else {
    observed.forEach(function (el) {
      el.classList.add("in");
    });
  }

  // ---------- Carte de code : légère inclinaison 3D ----------
  var card = document.querySelector(".code-card");
  if (card && finePointer && !reduced) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = "perspective(900px) rotateY(" + x * 6 + "deg) rotateX(" + -y * 6 + "deg)";
    });
    card.addEventListener("pointerleave", function () {
      card.style.transform = "";
    });
  }

  // ---------- Boutons aimantés ----------
  if (finePointer && !reduced) {
    document.querySelectorAll(".btn").forEach(function (b) {
      b.addEventListener("pointermove", function (e) {
        var r = b.getBoundingClientRect();
        var x = e.clientX - r.left - r.width / 2;
        var y = e.clientY - r.top - r.height / 2;
        b.style.transform = "translate(" + x * 0.15 + "px," + y * 0.25 + "px)";
      });
      b.addEventListener("pointerleave", function () {
        b.style.transform = "";
      });
    });
  }

  // ---------- Parallaxe de la photo ----------
  var portrait = document.querySelector(".portrait-img img");
  if (portrait && !reduced) {
    var frame = portrait.parentNode;
    window.addEventListener(
      "scroll",
      function () {
        var r = frame.getBoundingClientRect();
        var k = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        portrait.style.transform = "translateY(" + (-8 + k * 10) + "%)";
      },
      { passive: true }
    );
  }

  // ---------- Galerie : glisser pour défiler ----------
  document.querySelectorAll(".gallery").forEach(function (g) {
    var down = false,
      startX = 0,
      startScroll = 0;
    g.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") return;
      down = true;
      startX = e.clientX;
      startScroll = g.scrollLeft;
      g.classList.add("dragging");
    });
    window.addEventListener("pointermove", function (e) {
      if (down) g.scrollLeft = startScroll - (e.clientX - startX);
    });
    window.addEventListener("pointerup", function () {
      down = false;
      g.classList.remove("dragging");
    });
  });

  // ---------- Copier l'email ----------
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    var initial = btn.textContent;
    btn.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(btn.dataset.copy).then(function () {
        btn.textContent = "Copié ✦";
        setTimeout(function () {
          btn.textContent = initial;
        }, 1800);
      });
    });
  });

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
