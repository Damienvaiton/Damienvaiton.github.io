(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");

  // langue
  // / et /en/ sont deux pages statiques (tools/build-en.py). Seule la 404 se traduit sur place.
  var EN = window.I18N_EN || {};
  var altFr = document.querySelector('link[rel="alternate"][hreflang="fr"]');
  var altEn = document.querySelector('link[rel="alternate"][hreflang="en"]');
  var staticPages = !!(altFr && altEn);
  // même chemin que le hreflang, mais sur le domaine courant (marche aussi en local)
  function altUrl(link) {
    return location.origin + new URL(link.href).pathname + location.hash;
  }
  var isBot = /bot|crawl|spider|slurp|lighthouse|headlesschrome|gptbot|claude|perplexity/i.test(navigator.userAgent);
  var urlLang = new URLSearchParams(location.search).get("lang");
  var saved = null;
  try {
    saved = localStorage.getItem("lang");
  } catch (e) {}
  if (saved !== "fr" && saved !== "en") saved = null;
  var browserLang = /^fr/i.test(navigator.language || "fr") ? "fr" : "en";
  var lang;
  if (staticPages) {
    lang = root.lang === "en" ? "en" : "fr";
    // pas de redirection pour les robots, sinon Google ne verrait jamais la version FR
    if (!isBot) {
      var wanted = urlLang === "en" || urlLang === "fr" ? urlLang : saved;
      if (!wanted && lang === "fr") wanted = browserLang;
      if (wanted && wanted !== lang) {
        location.replace(altUrl(wanted === "en" ? altEn : altFr));
        return;
      }
    }
  } else {
    lang = urlLang === "en" || urlLang === "fr" ? urlLang : saved || (isBot ? "fr" : browserLang);
  }
  function tr(key, fr) {
    return lang === "en" && EN[key] != null ? EN[key] : fr;
  }
  var langHooks = [];
  function applyLang() {
    root.lang = lang;
    if (!staticPages) {
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
    }
    document.querySelectorAll(".lang-btn [data-l]").forEach(function (sp) {
      sp.classList.toggle("on", sp.getAttribute("data-l") === lang);
    });
    langHooks.forEach(function (fn) {
      fn();
    });
  }
  applyLang();
  document.querySelectorAll(".lang-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = lang === "fr" ? "en" : "fr";
      try {
        localStorage.setItem("lang", next);
      } catch (e) {}
      if (staticPages) {
        location.href = altUrl(next === "en" ? altEn : altFr);
        return;
      }
      lang = next;
      applyLang();
    });
  });

  // chasse aux secrets
  // indices dans la console ; la piste 13 n'apparaît qu'une fois les 6 trouvés
  var SECRETS = ["clock", "vinyl", "dawn", "bracelet", "kitty", "lost"];
  var HINTS = {
    clock: "L'heure, en haut de la page, n'est pas qu'une décoration.",
    vinyl: "Un vinyle, ça se scratche.",
    dawn: "Va jusqu'au bout de la nuit.",
    bracelet: "À l'Eras Tour, on s'échange quelque chose.",
    kitty: "Kitty en est à 8 victoires d'affilée. Aide-la.",
    lost: "Perds-toi.",
  };
  var PISTE_13 = (location.pathname.indexOf("/en/") === 0 ? "/en/" : "/") + "piste-13.html";
  function foundSecrets() {
    try {
      var list = JSON.parse(localStorage.getItem("secrets") || "[]");
      return Array.isArray(list)
        ? list.filter(function (k) {
            return SECRETS.indexOf(k) >= 0;
          })
        : [];
    } catch (e) {
      return [];
    }
  }
  function unlocked() {
    return foundSecrets().length === SECRETS.length;
  }
  function secret(id, delay) {
    var list = foundSecrets();
    if (list.indexOf(id) >= 0) return;
    list.push(id);
    var done = list.length === SECRETS.length;
    try {
      localStorage.setItem("secrets", JSON.stringify(list));
      if (done) localStorage.setItem("secretsDone", String(Date.now()));
    } catch (e) {
      return;
    }
    setTimeout(function () {
      if (done) {
        toast(tr("js.unlocked", "Piste 13 débloquée →"), PISTE_13);
        addHiddenTrack();
      } else {
        toast(tr("js.secret", "Secret trouvé · {n}/{t}").replace("{n}", list.length).replace("{t}", SECRETS.length));
      }
    }, delay || 600);
  }
  function toast(text, href) {
    var t = document.createElement(href ? "a" : "div");
    t.className = "secret-toast";
    if (href) t.href = href;
    else t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        t.classList.add("on");
      });
    });
    setTimeout(function () {
      t.classList.remove("on");
      setTimeout(function () {
        t.remove();
      }, 700);
    }, href ? 9000 : 3400);
  }
  function addHiddenTrack() {
    var list = document.querySelector(".tracklist");
    if (!list || list.querySelector(".track-ghost")) return;
    var li = document.createElement("li");
    li.className = "track track-ghost";
    li.innerHTML =
      '<a href="piste-13.html"><span class="track-n">13</span><h3></h3><span class="track-desc"></span><span class="track-tech"></span>' +
      '<svg class="track-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>';
    li.querySelector("h3").textContent = tr("track.ghost", "Piste cachée");
    li.querySelector(".track-desc").textContent = tr("track.ghostDesc", "Tu as trouvé les six secrets.");
    list.appendChild(li);
  }
  if (unlocked()) addHiddenTrack();
  if (document.querySelector(".hero.lost")) secret("lost", 1500);

  // sans attendre les images ni les polices (LCP)
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      root.classList.add("loaded");
    });
  });

  // ciel
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

  // easter egg : l'horloge de minuit
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
    secret("clock", 6200);
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
    var got0 = foundSecrets();
    var lines = [
      tr("js.hunt", "Psst. {t} secrets sont cachés sur ce site ({n} trouvés).")
        .replace("{t}", SECRETS.length)
        .replace("{n}", got0.length),
    ];
    SECRETS.forEach(function (k) {
      if (got0.indexOf(k) < 0) lines.push("· " + tr("t13." + k + "H", HINTS[k]));
    });
    console.log("%c" + lines.join("\n"), "font: italic 15px Georgia, serif; color: #d9b45f; padding: 6px 0; line-height: 1.6;");
  }
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

  // Last.fm
  var np = document.querySelector(".now-playing[data-lastfm-user]");
  if (np && np.dataset.lastfmUser && np.dataset.lastfmKey) {
    var npText = np.querySelector("[data-i18n]");
    var vinylLabel = np.querySelector(".vinyl-label");
    var npTrack = null;
    var coverUrl = null;
    function setCover(src) {
      if (!vinylLabel || src === coverUrl) return;
      coverUrl = src;
      // Last.fm renvoie une image grise générique quand il n'a pas de pochette
      if (!src || /2a96cbd8b46e442fc41c2b86b821562f/.test(src) || !/^https:\/\/[^"'()\s\\]+$/.test(src)) {
        vinylLabel.style.backgroundImage = "";
        return;
      }
      var im = new Image();
      im.onload = function () {
        if (coverUrl === src) vinylLabel.style.backgroundImage = 'url("' + src + '")';
      };
      im.src = src;
    }
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
      inner.appendChild(document.createTextNode(" · " + npTrack.artist));
      npText.appendChild(inner);
      np.classList.toggle("paused", !npTrack.live);
      np.title = npTrack.name + " · " + npTrack.artist;
      setCover(npTrack.cover);
      fitNowPlaying();
    }
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
          var img = (t.image || []).filter(function (i) {
            return i.size === "medium";
          })[0];
          npTrack = {
            cover: img && img["#text"],
            name: t.name,
            artist: (t.artist && (t.artist["#text"] || t.artist.name)) || "",
            live: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
          };
          renderNowPlaying();
        })
        .catch(function () {
        });
    }
    fetchNowPlaying();
    setInterval(fetchNowPlaying, 60000);
    document.addEventListener("visibilitychange", fetchNowPlaying);
  }
  (function () {
    if (new Date().getHours() >= 5) return;
    try {
      if (sessionStorage.getItem("owl")) return;
      sessionStorage.setItem("owl", "1");
    } catch (e) {}
    setTimeout(function () {
      var d = new Date();
      var time = pad(d.getHours()) + ":" + pad(d.getMinutes());
      var owl = document.createElement("div");
      owl.className = "owl";
      owl.setAttribute("role", "status");
      owl.innerHTML =
        '<span class="owl-moon" aria-hidden="true">☾</span><p>' +
        tr("js.owl", "Toi aussi tu traînes ici à <b>{t}</b>&nbsp;?<br /><em>Bienvenue chez les oiseaux de nuit.</em>").replace("{t}", time) +
        '</p><button type="button" class="owl-close" aria-label="' + tr("js.owlClose", "Fermer") + '">×</button>';
      document.body.appendChild(owl);
      requestAnimationFrame(function () {
        owl.classList.add("on");
      });
      function hide() {
        owl.classList.remove("on");
        setTimeout(function () {
          owl.remove();
        }, 700);
      }
      owl.querySelector(".owl-close").addEventListener("click", hide);
      setTimeout(hide, 10000);
    }, 2500);
  })();
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

  // l'horloge suit le scroll : 00:00 en haut, 06:00 en bas
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

  var dawnFound = false;
  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle("scrolled", y > 30);
    if (!timed.length) return;

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
    if (dawn >= 0.99 && !dawnFound) {
      dawnFound = true;
      secret("dawn");
    }

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

  // bracelet d'amitié
  // couleurs tirées du mot : même mot, même bracelet
  var BEADS = [
    ["#fff4cf", "#d9b45f", "#8a6a22"], // or
    ["#6670d6", "#2a3180", "#10133a"], // nuit
    ["#ece3ff", "#a68fe8", "#5e4aa3"], // lavande
    ["#ffffff", "#dcd9ea", "#9a96b5"], // perle
    ["#ffdbe6", "#e690ad", "#9c4766"], // rose
  ];
  function cleanWord(v) {
    return (v || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9 &!?♥]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 14);
  }
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h = (h + 0x6d2b79f5) | 0;
      var t = Math.imul(h ^ (h >>> 15), h | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // compact : moins de perles autour du mot, pour les petits écrans
  function beadsFor(word, compact) {
    var rand = seeded(word || "*");
    var side = compact ? 1 : 2;
    var seq = [];
    function rounds(n) {
      for (var i = 0; i < n; i++) seq.push({ t: "round", c: BEADS[(rand() * BEADS.length) | 0] });
    }
    rounds(side);
    seq.push({ t: "star" });
    rounds(side);
    word.split("").forEach(function (ch) {
      if (ch === " ") rounds(1);
      else seq.push({ t: "letter", ch: ch, gold: rand() < 0.2 });
    });
    rounds(side);
    seq.push({ t: "star" });
    rounds(side);
    return seq;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function starPath(g, r) {
    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0);
    g.quadraticCurveTo(r * 0.18, r * 0.18, 0, r);
    g.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0);
    g.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r);
    g.closePath();
  }
  // prog : de 0 à 1, les perles tombent une à une sur le fil
  function drawBracelet(g, W, H, word, prog) {
    var seq = beadsFor(word, W < 520);
    var n = seq.length;
    var units = 0;
    seq.forEach(function (b) {
      units += b.t === "letter" ? 1 : 0.78;
    });
    var unit = Math.min(H * 0.27, (W * 0.88) / (units + (n - 1) * 0.08));
    var gap = unit * 0.08;
    var total = unit * units + gap * (n - 1);
    var cx = W / 2;
    var baseY = H * 0.36;
    var sag = H * 0.2;
    function yAt(px) {
      var k = (px - cx) / (W * 0.5);
      return baseY + sag * (1 - k * k);
    }
    function angleAt(px) {
      return Math.atan((-2 * sag * (px - cx)) / (W * W * 0.25));
    }

    g.save();
    g.strokeStyle = "rgba(236, 211, 148, 0.6)";
    g.lineWidth = Math.max(1, unit * 0.05);
    g.lineCap = "round";
    g.beginPath();
    for (var sx = W * 0.05; sx <= W * 0.95; sx += 3) {
      if (sx === W * 0.05) g.moveTo(sx, yAt(sx));
      else g.lineTo(sx, yAt(sx));
    }
    g.stroke();
    [W * 0.05, W * 0.95].forEach(function (ex, side) {
      var dir = side ? 1 : -1;
      var ey = yAt(ex);
      g.fillStyle = "rgba(236, 211, 148, 0.8)";
      g.beginPath();
      g.arc(ex, ey, unit * 0.09, 0, Math.PI * 2);
      g.fill();
      for (var k = 0; k < 2; k++) {
        g.beginPath();
        g.moveTo(ex, ey);
        g.quadraticCurveTo(ex + dir * unit * 0.3, ey + unit * (0.25 + k * 0.2), ex + dir * unit * (0.25 + k * 0.15), ey + unit * (0.6 + k * 0.25));
        g.stroke();
      }
    });
    g.restore();

    var x = cx - total / 2;
    seq.forEach(function (b, i) {
      var bw = b.t === "letter" ? unit : unit * 0.78;
      var bx = x + bw / 2;
      x += bw + gap;
      var appear = prog >= 1 ? 1 : Math.max(0, Math.min(1, (prog * (n + 6) - i) / 6));
      if (appear <= 0) return;
      var e = 1 - Math.pow(1 - appear, 3);
      var by = yAt(bx) - (1 - e) * H * 0.3;
      g.save();
      g.globalAlpha = e;
      g.translate(bx, by);
      g.rotate(angleAt(bx));
      g.shadowColor = "rgba(0, 0, 0, 0.4)";
      g.shadowBlur = unit * 0.25;
      g.shadowOffsetY = unit * 0.08;
      if (b.t === "letter") {
        var s = unit;
        var grad = g.createLinearGradient(0, -s / 2, 0, s / 2);
        if (b.gold) {
          grad.addColorStop(0, "#fff4cf");
          grad.addColorStop(0.5, "#e2c06e");
          grad.addColorStop(1, "#a8862f");
        } else {
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(1, "#d9d5ca");
        }
        roundRect(g, -s / 2, -s / 2, s, s, s * 0.18);
        g.fillStyle = grad;
        g.fill();
        g.shadowColor = "transparent";
        g.fillStyle = "rgba(255, 255, 255, 0.55)";
        roundRect(g, -s * 0.38, -s * 0.42, s * 0.5, s * 0.14, s * 0.07);
        g.fill();
        g.fillStyle = b.gold ? "#2b1f06" : "#14163a";
        g.font = "500 " + Math.round(s * 0.56) + "px Switzer, system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(b.ch, 0, s * 0.04);
      } else if (b.t === "star") {
        var rs = unit * 0.46;
        var sg = g.createLinearGradient(-rs, -rs, rs, rs);
        sg.addColorStop(0, "#fff4cf");
        sg.addColorStop(0.5, "#d9b45f");
        sg.addColorStop(1, "#9c7a2b");
        starPath(g, rs);
        g.fillStyle = sg;
        g.fill();
      } else {
        var r = unit * 0.39;
        var rg = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
        rg.addColorStop(0, b.c[0]);
        rg.addColorStop(0.55, b.c[1]);
        rg.addColorStop(1, b.c[2]);
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fillStyle = rg;
        g.fill();
      }
      g.restore();
    });
  }

  var bCanvas = document.querySelector(".bracelet-canvas");
  if (bCanvas && bCanvas.getContext) {
    var bCtx = bCanvas.getContext("2d");
    var bInput = document.getElementById("bracelet-word");
    var bForm = document.querySelector(".bracelet-form");
    var bShown = false;
    var fontsReady =
      document.fonts && document.fonts.load
        ? Promise.all([document.fonts.load("500 20px Switzer"), document.fonts.load("italic 400 20px 'IM Fell DW Pica'")]).catch(function () {})
        : Promise.resolve();
    var bWord = function () {
      return cleanWord(bInput.value);
    };
    var renderBracelet = function (prog) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = bCanvas.clientWidth;
      var H = bCanvas.clientHeight;
      if (!W || !H) return;
      if (bCanvas.width !== Math.round(W * dpr) || bCanvas.height !== Math.round(H * dpr)) {
        bCanvas.width = Math.round(W * dpr);
        bCanvas.height = Math.round(H * dpr);
      }
      bCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bCtx.clearRect(0, 0, W, H);
      drawBracelet(bCtx, W, H, bWord(), prog);
    };
    var labelBracelet = function () {
      var w = bWord();
      bCanvas.setAttribute("aria-label", tr("js.braceletAlt", "Bracelet d'amitié") + (w ? " : " + w : ""));
    };
    var showBracelet = function () {
      if (bShown) return;
      bShown = true;
      fontsReady.then(function () {
        if (reduced) return renderBracelet(1);
        var t0 = performance.now();
        (function anim(t) {
          var k = Math.min(1, (t - t0) / 1800);
          renderBracelet(k);
          if (k < 1) requestAnimationFrame(anim);
        })(t0);
      });
    };
    labelBracelet();
    if ("IntersectionObserver" in window) {
      var bio = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) {
            bio.disconnect();
            showBracelet();
          }
        },
        { threshold: 0.4 }
      );
      bio.observe(bCanvas);
    } else {
      showBracelet();
    }
    langHooks.push(labelBracelet);
    window.addEventListener("resize", function () {
      if (bShown) renderBracelet(1);
    });
    bInput.addEventListener("input", function () {
      bShown = true;
      renderBracelet(1);
      labelBracelet();
      if (bWord()) secret("bracelet", 1200);
    });
    // export en 1200x630 pour les réseaux
    bForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var word = bWord();
      var out = document.createElement("canvas");
      out.width = 1200;
      out.height = 630;
      var g = out.getContext("2d");
      var sky = g.createLinearGradient(0, 0, 0, 630);
      sky.addColorStop(0, "#151a45");
      sky.addColorStop(1, "#080b1d");
      g.fillStyle = sky;
      g.fillRect(0, 0, 1200, 630);
      var halo = g.createRadialGradient(600, 300, 0, 600, 300, 520);
      halo.addColorStop(0, "rgba(217, 180, 95, 0.12)");
      halo.addColorStop(1, "rgba(217, 180, 95, 0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, 1200, 630);
      var rand = seeded("sky" + word);
      for (var i = 0; i < 160; i++) {
        g.fillStyle = (rand() < 0.1 ? "rgba(236,211,148," : "rgba(236,233,247,") + (rand() * 0.6 + 0.15) + ")";
        g.beginPath();
        g.arc(rand() * 1200, rand() * 630, rand() * 1.4 + 0.3, 0, Math.PI * 2);
        g.fill();
      }
      fontsReady.then(function () {
        g.save();
        g.translate(60, 130);
        drawBracelet(g, 1080, 320, word, 1);
        g.restore();
        g.fillStyle = "#ecd394";
        g.font = "italic 400 34px 'IM Fell DW Pica', Georgia, serif";
        g.textAlign = "center";
        g.fillText("damienvaiton.fr", 600, 560);
        out.toBlob(function (blob) {
          if (!blob) return;
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "bracelet-" + (word.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "midnights") + ".png";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () {
            URL.revokeObjectURL(a.href);
          }, 2000);
        }, "image/png");
      });
      if (word) secret("bracelet", 1200);
    });
  }
  var vinyl = document.querySelector(".vinyl");
  if (vinyl) {
    vinyl.addEventListener("click", function () {
      vinyl.classList.remove("scratch");
      void vinyl.offsetWidth;
      vinyl.classList.add("scratch");
      secret("vinyl", 900);
    });
    vinyl.addEventListener("animationend", function (e) {
      if (e.animationName === "scratch") vinyl.classList.remove("scratch");
    });
  }
  var replay = document.querySelector(".dc-replay");
  if (replay) {
    var streak = 8;
    replay.addEventListener("click", function () {
      streak++;
      document.querySelectorAll(".dc-streak").forEach(function (el) {
        el.textContent = streak;
        el.classList.remove("bump");
        void el.offsetWidth;
        el.classList.add("bump");
      });
      secret("kitty", 700);
    });
  }

  // piste 13
  var secretList = document.querySelector(".secrets");
  if (secretList) {
    var got = foundSecrets();
    secretList.querySelectorAll("[data-secret]").forEach(function (li) {
      li.classList.toggle("found", got.indexOf(li.getAttribute("data-secret")) >= 0);
    });
    var countEl = document.querySelector(".secrets-n");
    if (countEl) countEl.textContent = got.length;
    if (got.length === SECRETS.length) {
      document.querySelectorAll(".t13-locked").forEach(function (el) {
        el.hidden = true;
      });
      document.querySelectorAll(".t13-open").forEach(function (el) {
        el.hidden = false;
      });
      ticket();
    }
  }

  function ticket() {
    var tc = document.querySelector(".ticket-canvas");
    if (!tc || !tc.getContext) return;
    var tInput = document.getElementById("ticket-name");
    var tForm = document.querySelector(".ticket-form");
    var when = new Date();
    try {
      var stamp = +localStorage.getItem("secretsDone");
      if (stamp) when = new Date(stamp);
    } catch (e) {}
    var fonts =
      document.fonts && document.fonts.load
        ? Promise.all([
            document.fonts.load("italic 400 40px 'IM Fell DW Pica'"),
            document.fonts.load("400 40px 'IM Fell DW Pica'"),
            document.fonts.load("400 14px 'IBM Plex Mono'"),
          ]).catch(function () {})
        : Promise.resolve();
    function name() {
      return (tInput.value || "").trim().slice(0, 18) || tr("js.ticketAnon", "Oiseau de nuit");
    }
    function body(g) {
      g.beginPath();
      g.moveTo(38, 10);
      g.arcTo(1190, 10, 1190, 490, 28);
      g.arcTo(1190, 490, 10, 490, 28);
      g.arcTo(10, 490, 10, 10, 28);
      g.arcTo(10, 10, 1190, 10, 28);
      g.closePath();
    }
    function label(g, text, x, y, align) {
      g.font = "400 14px 'IBM Plex Mono', monospace";
      g.fillStyle = "#d9b45f";
      g.textAlign = align || "left";
      if ("letterSpacing" in g) g.letterSpacing = "3px";
      g.fillText(text.toUpperCase(), x, y);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
    }
    function value(g, text, x, y, align) {
      g.font = "400 30px 'IM Fell DW Pica', Georgia, serif";
      g.fillStyle = "#ece9f7";
      g.textAlign = align || "left";
      g.fillText(text, x, y);
    }
    function draw(g) {
      var gold = g.createLinearGradient(0, 0, 1200, 500);
      gold.addColorStop(0, "#9c7a2b");
      gold.addColorStop(0.3, "#f5e1a0");
      gold.addColorStop(0.5, "#c9a24a");
      gold.addColorStop(0.7, "#fff4cf");
      gold.addColorStop(1, "#a8862f");

      g.save();
      body(g);
      var bg = g.createLinearGradient(0, 0, 1200, 500);
      bg.addColorStop(0, "#171c4a");
      bg.addColorStop(1, "#0a0d24");
      g.fillStyle = bg;
      g.fill();
      g.clip();
      var rand = seeded("ticket" + name());
      for (var i = 0; i < 90; i++) {
        g.fillStyle = "rgba(236,233,247," + (rand() * 0.45 + 0.1) + ")";
        g.beginPath();
        g.arc(rand() * 1200, rand() * 500, rand() * 1.3 + 0.3, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();

      g.lineWidth = 2;
      g.strokeStyle = gold;
      body(g);
      g.stroke();
      g.save();
      g.globalCompositeOperation = "destination-out";
      [10, 490].forEach(function (y) {
        g.beginPath();
        g.arc(860, y, 26, 0, Math.PI * 2);
        g.fill();
      });
      g.restore();
      g.save();
      body(g);
      g.clip();
      [10, 490].forEach(function (y) {
        g.beginPath();
        g.arc(860, y, 26, 0, Math.PI * 2);
        g.stroke();
      });
      g.restore();
      g.save();
      g.setLineDash([6, 9]);
      g.strokeStyle = "rgba(217, 180, 95, 0.5)";
      g.beginPath();
      g.moveTo(860, 46);
      g.lineTo(860, 454);
      g.stroke();
      g.restore();

      label(g, "damienvaiton.fr", 70, 82);
      g.font = "italic 400 120px 'IM Fell DW Pica', Georgia, serif";
      g.fillStyle = gold;
      g.textAlign = "left";
      g.fillText(tr("js.ticketTitle", "Piste 13"), 64, 215);
      g.font = "italic 400 26px 'IM Fell DW Pica', Georgia, serif";
      g.fillStyle = "#b9acec";
      g.fillText(tr("js.ticketSub", "Les six secrets, trouvés."), 70, 268);
      var loc = lang === "en" ? "en-GB" : "fr-FR";
      label(g, tr("js.ticketName", "Nom"), 70, 372);
      value(g, name(), 70, 414);
      label(g, tr("js.ticketDate", "Date"), 460, 372);
      value(g, when.toLocaleDateString(loc), 460, 414);
      label(g, tr("js.ticketTime", "Heure"), 660, 372);
      value(g, pad(when.getHours()) + ":" + pad(when.getMinutes()), 660, 414);

      [
        [tr("js.ticketGate", "Porte"), "00:00"],
        [tr("js.ticketRow", "Rang"), "13"],
        [tr("js.ticketSeat", "Place"), "13"],
      ].forEach(function (f, k) {
        label(g, f[0], 1025, 88 + k * 92, "center");
        value(g, f[1], 1025, 126 + k * 92, "center");
      });
      var bars = seeded("bars" + name());
      g.fillStyle = "rgba(236, 233, 247, 0.85)";
      for (var x = 915; x < 1135; ) {
        var w = 1 + ((bars() * 4) | 0);
        g.fillRect(x, 396, w, 56);
        x += w + 2 + ((bars() * 4) | 0);
      }
    }
    function render() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = tc.clientWidth;
      var H = tc.clientHeight;
      if (!W || !H) return;
      tc.width = Math.round(W * dpr);
      tc.height = Math.round(H * dpr);
      var g = tc.getContext("2d");
      g.setTransform((W * dpr) / 1200, 0, 0, (H * dpr) / 500, 0, 0);
      g.clearRect(0, 0, 1200, 500);
      draw(g);
    }
    fonts.then(render);
    window.addEventListener("resize", render);
    tInput.addEventListener("input", render);
    tForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var out = document.createElement("canvas");
      out.width = 1200;
      out.height = 500;
      fonts.then(function () {
        draw(out.getContext("2d"));
        out.toBlob(function (blob) {
          if (!blob) return;
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "piste-13.png";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () {
            URL.revokeObjectURL(a.href);
          }, 2000);
        }, "image/png");
      });
    });
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      var initial = btn.textContent;
      navigator.clipboard.writeText(btn.dataset.copy).then(function () {
        btn.textContent = tr("js.copied", "Copié");
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
