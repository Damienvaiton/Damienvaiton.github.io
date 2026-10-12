// Ciel étoilé, horloge de la nuit, apparitions, aperçus des projets.
(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;
  root.classList.add("js");

  // ---------- Langue : français dans le HTML, anglais dans i18n.js ----------
  var EN = window.I18N_EN || {};
  // Priorité : ?lang= dans l'URL (liens hreflang), puis le choix mémorisé,
  // puis la langue du navigateur. Les robots d'indexation voient le français.
  var urlLang = new URLSearchParams(location.search).get("lang");
  var isBot = /bot|crawl|spider|slurp|lighthouse|headlesschrome|gptbot|claude|perplexity/i.test(navigator.userAgent);
  var lang = (function () {
    if (urlLang === "fr" || urlLang === "en") return urlLang;
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "fr" || saved === "en") return saved;
    } catch (e) {}
    if (isBot) return "fr";
    return /^fr/i.test(navigator.language || "fr") ? "fr" : "en";
  })();
  var canonical = document.querySelector('link[rel="canonical"]');
  var canonicalFr = canonical && canonical.getAttribute("href");
  function tr(key, fr) {
    return lang === "en" && EN[key] != null ? EN[key] : fr;
  }
  var langHooks = [];
  function applyLang() {
    root.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      if (el._fr === undefined) el._fr = el.innerHTML;
      el.innerHTML = tr(el.getAttribute("data-i18n"), el._fr);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el._frAttr = el._frAttr || {};
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var parts = pair.split(":");
        var attr = parts[0];
        if (!(attr in el._frAttr)) el._frAttr[attr] = el.getAttribute(attr);
        el.setAttribute(attr, tr(parts[1], el._frAttr[attr]));
      });
    });
    document.querySelectorAll(".lang-btn [data-l]").forEach(function (sp) {
      sp.classList.toggle("on", sp.getAttribute("data-l") === lang);
    });
    if (canonical && canonicalFr) canonical.setAttribute("href", lang === "en" ? canonicalFr + "?lang=en" : canonicalFr);
    langHooks.forEach(function (fn) {
      fn();
    });
  }
  applyLang();
  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      lang = lang === "fr" ? "en" : "fr";
      try {
        localStorage.setItem("lang", lang);
      } catch (e) {}
      // L'URL reflète la langue affichée (lien partageable, cohérent avec hreflang)
      var u = new URL(location.href);
      if (lang === "en") u.searchParams.set("lang", "en");
      else u.searchParams.delete("lang");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
      applyLang();
    });
  });

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
  var meteorShower = function () {};
  var canvas = document.querySelector(".stars");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d");
    var stars = [];
    var shots = [];
    var nextShot = 4000;
    var showerUntil = 0;
    var now = 0;
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

    function launch(t) {
      shots.push({
        t0: t,
        d: 900 + Math.random() * 500,
        x: Math.random() * w * 0.8 + w * 0.2,
        y: Math.random() * h * 0.45,
        dx: -(Math.random() * 300 + 250),
        dy: Math.random() * 120 + 90,
      });
    }

    function draw(t) {
      now = t;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var alpha = reduced ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * s.s + s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.gold ? "rgba(236,211,148," + alpha + ")" : "rgba(236,233,247," + alpha + ")";
        ctx.fill();
      }
      shots = shots.filter(function (sh) {
        var k = (t - sh.t0) / sh.d;
        if (k >= 1) return false;
        var x = sh.x + sh.dx * k;
        var y = sh.y + sh.dy * k;
        var g = ctx.createLinearGradient(x, y, x - sh.dx * 0.18, y - sh.dy * 0.18);
        var fade = Math.sin(k * Math.PI);
        g.addColorStop(0, "rgba(255,244,207," + fade + ")");
        g.addColorStop(1, "rgba(255,244,207,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - sh.dx * 0.18, y - sh.dy * 0.18);
        ctx.stroke();
        return true;
      });
      if (!reduced) {
        if (t < showerUntil && Math.random() < 0.18) launch(t);
        if (t > nextShot) {
          launch(t);
          nextShot = t + 7000 + Math.random() * 9000;
        }
        requestAnimationFrame(draw);
      }
    }

    meteorShower = function (ms) {
      showerUntil = now + ms;
    };

    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(draw);
  }

  // ---------- Easter egg : l'horloge de minuit ----------
  // Cliquer sur l'horloge du menu (ou taper « midnights ») fait apparaître
  // une grande horloge qui avance jusqu'à minuit, puis pluie d'étoiles.
  var NUMERALS = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

  function clockSvg() {
    var ticks = "";
    for (var i = 0; i < 60; i++) {
      var big = i % 5 === 0;
      ticks +=
        '<rect x="' + (big ? 198 : 198.8) + '" y="17" width="' + (big ? 4 : 2.4) + '" height="' + (big ? 15 : 11) +
        '" transform="rotate(' + i * 6 + ' 200 200)"/>';
    }
    var nums = "";
    NUMERALS.forEach(function (n, k) {
      nums += '<text x="200" y="82" transform="rotate(' + k * 30 + ' 200 200)">' + n + "</text>";
    });
    return (
      '<svg viewBox="0 0 400 400" aria-hidden="true">' +
      '<defs>' +
      '<radialGradient id="eggFace" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#f6f4ee"/><stop offset="1" stop-color="#d9d5ca"/></radialGradient>' +
      '<linearGradient id="eggRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b0413e"/><stop offset=".5" stop-color="#7d2422"/><stop offset="1" stop-color="#a3403a"/></linearGradient>' +
      '<linearGradient id="eggGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4cf"/><stop offset=".5" stop-color="#d9b45f"/><stop offset="1" stop-color="#9c7a2b"/></linearGradient>' +
      '<filter id="eggPaper"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" result="n"/><feColorMatrix in="n" type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .07"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="multiply"/></filter>' +
      "</defs>" +
      '<circle cx="200" cy="200" r="194" fill="url(#eggFace)" filter="url(#eggPaper)"/>' +
      '<circle class="egg-rim" cx="200" cy="200" r="193" fill="none" stroke="url(#eggRim)" stroke-width="12"/>' +
      '<circle class="egg-rim-gold" cx="200" cy="200" r="193" fill="none" stroke="url(#eggGold)" stroke-width="12"/>' +
      '<circle cx="200" cy="200" r="183" fill="none" stroke="#1b1b1b" stroke-width="1.5"/>' +
      '<circle cx="200" cy="200" r="166" fill="none" stroke="#1b1b1b" stroke-width="1.5"/>' +
      '<g fill="#1b1b1b">' + ticks + "</g>" +
      '<g class="egg-nums">' + nums + "</g>" +
      '<circle cx="200" cy="200" r="112" fill="none" stroke="#1b1b1b" stroke-width="2"/>' +
      '<circle cx="200" cy="200" r="106" fill="none" stroke="#1b1b1b" stroke-width="1"/>' +
      '<g class="egg-hand egg-hour"><path d="M197 206 L196.5 120 L191 108 L200 82 L209 108 L203.5 120 L203 206 Z" fill="#111"/></g>' +
      '<g class="egg-hand egg-min"><path d="M198.6 214 L199.2 40 L200 26 L200.8 40 L201.4 214 Z" fill="#111"/></g>' +
      '<circle cx="200" cy="200" r="7" fill="#111"/><circle cx="200" cy="200" r="2.5" fill="#d9b45f"/>' +
      "</svg>"
    );
  }

  function glitter() {
    var gc = document.createElement("canvas");
    gc.className = "glitter";
    document.body.appendChild(gc);
    var g = gc.getContext("2d");
    var gw = (gc.width = window.innerWidth);
    var gh = (gc.height = window.innerHeight);
    var colors = ["#fff4cf", "#f5e1a0", "#ecd394", "#d9b45f", "#b48c36"];
    var bits = [];
    for (var i = 0; i < 170; i++) {
      bits.push({
        x: Math.random() * gw,
        y: Math.random() * gh * 0.75 - gh * 0.6,
        vy: Math.random() * 2.2 + 1.4,
        sway: Math.random() * 2 + 0.5,
        phase: Math.random() * Math.PI * 2,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.2,
        size: Math.random() * 5 + 2,
        star: Math.random() < 0.3,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
    // Étoiles filantes dessinées au-dessus du voile de l'horloge
    var streaks = [];
    for (var s2 = 0; s2 < 14; s2++) {
      streaks.push({
        t0: Math.random() * 3000,
        d: 700 + Math.random() * 500,
        x: Math.random() * gw * 0.8 + gw * 0.2,
        y: Math.random() * gh * 0.5,
        dx: -(Math.random() * 350 + 300),
        dy: Math.random() * 150 + 120,
      });
    }
    var start = performance.now();
    (function fall(t) {
      var el = t - start;
      g.clearRect(0, 0, gw, gh);
      g.globalAlpha = 1;
      streaks.forEach(function (sk) {
        var k = (el - sk.t0) / sk.d;
        if (k < 0 || k > 1) return;
        var x = sk.x + sk.dx * k;
        var y = sk.y + sk.dy * k;
        var grad = g.createLinearGradient(x, y, x - sk.dx * 0.25, y - sk.dy * 0.25);
        grad.addColorStop(0, "rgba(255,244,207," + Math.sin(k * Math.PI) + ")");
        grad.addColorStop(1, "rgba(255,244,207,0)");
        g.strokeStyle = grad;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - sk.dx * 0.25, y - sk.dy * 0.25);
        g.stroke();
      });
      g.globalAlpha = el > 3800 ? Math.max(0, 1 - (el - 3800) / 900) : Math.min(1, el / 300);
      bits.forEach(function (b) {
        b.y += b.vy;
        b.rot += b.vr;
        var x = b.x + Math.sin(el / 400 + b.phase) * b.sway * 6;
        g.save();
        g.translate(x, b.y);
        g.rotate(b.rot);
        g.fillStyle = b.color;
        if (b.star) {
          var r = b.size;
          g.beginPath();
          g.moveTo(0, -r);
          g.lineTo(r * 0.3, -r * 0.3);
          g.lineTo(r, 0);
          g.lineTo(r * 0.3, r * 0.3);
          g.lineTo(0, r);
          g.lineTo(-r * 0.3, r * 0.3);
          g.lineTo(-r, 0);
          g.lineTo(-r * 0.3, -r * 0.3);
          g.closePath();
          g.fill();
        } else {
          g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        }
        g.restore();
      });
      if (el < 4700) requestAnimationFrame(fall);
      else gc.remove();
    })(start);
  }

  var eggOpen = false;
  function midnight() {
    if (eggOpen) return;
    eggOpen = true;
    var ov = document.createElement("div");
    ov.className = "clock-egg";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Minuit");
    var bursts = "";
    for (var k = 0; k < 13; k++) bursts += '<i style="--a:' + (k * 360) / 13 + 'deg;--d:' + k * 0.03 + 's"></i>';
    ov.innerHTML =
      '<div class="egg-dial">' + clockSvg() + '<div class="egg-burst">' + bursts + "</div></div>" +
      '<p class="egg-caption"><span>00:00</span><em>Midnights</em></p>';
    document.body.appendChild(ov);
    var hour = ov.querySelector(".egg-hour");
    var min = ov.querySelector(".egg-min");
    function setTime(minutes) {
      // minutes depuis midi ; 720 = minuit
      min.style.transform = "rotate(" + (minutes % 60) * 6 + "deg)";
      hour.style.transform = "rotate(" + (minutes / 60) * 30 + "deg)";
    }
    var from = 11 * 60 + 47;
    var to = 12 * 60;
    setTime(reduced ? to : from);
    requestAnimationFrame(function () {
      ov.classList.add("on");
    });

    var timers = [];
    function close() {
      if (!eggOpen) return;
      timers.forEach(clearTimeout);
      ov.classList.remove("on");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        ov.remove();
        eggOpen = false;
      }, 700);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    ov.addEventListener("click", close);
    document.addEventListener("keydown", onKey);

    function strike() {
      ov.classList.add("midnight");
      if (!reduced) {
        meteorShower(3500);
        glitter();
      }
      timers.push(setTimeout(close, 5200));
    }
    if (reduced) {
      timers.push(setTimeout(strike, 300));
      return;
    }
    // Les aiguilles avancent jusqu'à minuit, en ralentissant à l'approche
    timers.push(
      setTimeout(function () {
        var t0 = performance.now();
        var dur = 2600;
        (function tick(t) {
          if (!eggOpen) return;
          var k = Math.min(1, (t - t0) / dur);
          var e = 1 - Math.pow(1 - k, 3);
          setTime(from + (to - from) * e);
          if (k < 1) requestAnimationFrame(tick);
          else strike();
        })(t0);
      }, 700)
    );
  }

  var navClock = document.querySelector(".clock");
  if (navClock) {
    navClock.setAttribute("role", "button");
    navClock.setAttribute("tabindex", "0");
    navClock.addEventListener("click", midnight);
    navClock.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        midnight();
      }
    });
  }
  var typed = "";
  window.addEventListener("keydown", function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key && e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).slice(-9);
      if (typed === "midnights") midnight();
    }
  });
  if (window.console && console.log) {
    console.log(
      "%c" + tr("js.hint", "✦ Psst… clique sur l'horloge, ou tape « midnights »."),
      "font: italic 15px Georgia, serif; color: #d9b45f; padding: 6px 0;"
    );
  }

  // ---------- Transition de sortie (navigateurs sans View Transitions) ----------
  if (!("CSSViewTransitionRule" in window) && !reduced) {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      var url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // simple ancre
      e.preventDefault();
      root.classList.add("leaving");
      setTimeout(function () {
        location.href = url.href;
      }, 380);
    });
    window.addEventListener("pageshow", function () {
      root.classList.remove("leaving");
    });
  }

  // ---------- « En fond sonore » : écoute en direct via Last.fm ----------
  var np = document.querySelector(".now-playing[data-lastfm-user]");
  if (np && np.dataset.lastfmUser && np.dataset.lastfmKey) {
    var npText = np.querySelector("[data-i18n]");
    var npTrack = null;
    function renderNowPlaying() {
      if (!npTrack) return;
      npText.removeAttribute("data-i18n");
      npText.textContent = "";
      var inner = document.createElement("span");
      inner.className = "np-inner";
      var label = npTrack.live ? tr("js.npNow", "En écoute") : tr("js.npLast", "Dernière écoute");
      inner.appendChild(document.createTextNode(label + " · "));
      var em = document.createElement("em");
      em.textContent = npTrack.name;
      inner.appendChild(em);
      inner.appendChild(document.createTextNode(" — " + npTrack.artist));
      npText.appendChild(inner);
      np.classList.toggle("paused", !npTrack.live);
      np.title = npTrack.name + " — " + npTrack.artist;
      fitNowPlaying();
    }
    // Si le texte dépasse, il défile d'un bout à l'autre
    function fitNowPlaying() {
      var inner = npText.querySelector(".np-inner");
      if (!inner) return;
      npText.classList.remove("scroll");
      var overflow = inner.scrollWidth - npText.clientWidth;
      if (overflow > 2) {
        npText.style.setProperty("--dist", overflow + 20 + "px");
        npText.style.setProperty("--dur", Math.max(6, (overflow + 20) / 25) + "s");
        npText.classList.add("scroll");
      }
    }
    window.addEventListener("resize", fitNowPlaying);
    langHooks.push(renderNowPlaying);
    function fetchNowPlaying() {
      if (document.hidden) return;
      var url =
        "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&format=json&limit=1" +
        "&user=" + encodeURIComponent(np.dataset.lastfmUser) +
        "&api_key=" + encodeURIComponent(np.dataset.lastfmKey);
      fetch(url)
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          var t = data && data.recenttracks && data.recenttracks.track && data.recenttracks.track[0];
          if (!t) return;
          npTrack = {
            name: t.name,
            artist: (t.artist && (t.artist["#text"] || t.artist.name)) || "",
            live: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
          };
          renderNowPlaying();
        })
        .catch(function () {
          // En cas d'erreur, on garde simplement le texte par défaut
        });
    }
    fetchNowPlaying();
    setInterval(fetchNowPlaying, 60000);
    document.addEventListener("visibilitychange", fetchNowPlaying);
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
  var clockText = clock && clock.querySelector(".clock-time");
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
    btn.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      var initial = btn.textContent;
      navigator.clipboard.writeText(btn.dataset.copy).then(function () {
        btn.textContent = tr("js.copied", "Copié ✦");
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
