(() => {
  const canvas = document.getElementById("stage");
  const scroller = document.getElementById("scroller");
  const progressBar = document.getElementById("progress");
  if (!canvas?.getContext) return;

  const ctx = canvas.getContext("2d");
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 880px)");
  const sections = Array.prototype.slice.call(document.querySelectorAll("[data-scene]"));
  const links = Array.prototype.slice.call(document.querySelectorAll(".marquee nav a"));
  const depths = Array.prototype.slice.call(document.querySelectorAll("[data-depth]"));
  const started = performance.now();
  const state = { index: 0, progress: 0, name: "hero" };
  let raf = 0;

  const scenes = {
    hero: sceneHero,
    talk: sceneTalk,
    slot: sceneSlot,
    hex: sceneHex,
    contracts: sceneContracts,
    build: sceneBuild,
    harness: sceneHarness,
    gates: sceneGates,
  };

  function reduced() {
    return reducedQuery.matches;
  }

  function mobile() {
    return mobileQuery.matches;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ease(t) {
    return t * t * (3 - 2 * t);
  }

  function scrollTop() {
    return mobile() ? scroller.scrollTop : window.scrollY;
  }

  function scrollMax() {
    if (mobile()) return Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  function focusY() {
    if (mobile()) {
      const rect = scroller.getBoundingClientRect();
      return rect.top + rect.height * 0.32;
    }
    return window.innerHeight * 0.42;
  }

  function measure() {
    const y = focusY();
    let best = 0;
    let bestDist = Infinity;
    let progress = 0;
    for (let i = 0; i < sections.length; i++) {
      const rect = sections[i].getBoundingClientRect();
      let dist = Math.abs(rect.top + rect.height / 2 - y);
      if (rect.top <= y && rect.bottom >= y) dist -= 10000;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
        progress = clamp((y - rect.top) / Math.max(rect.height, 1), 0, 1);
      }
    }
    state.index = best;
    state.progress = progress;
    state.name = sections[best].getAttribute("data-scene");
    markCurrent(best);
    moveParallax();
    progressBar.style.transform = `scaleX(${clamp(scrollTop() / scrollMax(), 0, 1)})`;
  }

  function markCurrent(index) {
    for (let i = 0; i < sections.length; i++) {
      sections[i].classList.toggle("is-active", i === index);
      if (links[i]) {
        if (i === index) links[i].setAttribute("aria-current", "true");
        else links[i].removeAttribute("aria-current");
      }
    }
  }

  function moveParallax() {
    const damp = mobile() ? 0.035 : 0.07;
    const top = scrollTop();
    for (let i = 0; i < depths.length; i++) {
      if (reduced()) {
        depths[i].style.transform = "";
        continue;
      }
      const depth = Number(depths[i].getAttribute("data-depth")) || 0;
      const shift = (-top * depth * damp).toFixed(2);
      depths[i].style.transform = `translate3d(0,${shift}px,0)`;
    }
  }

  function frame() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.max(1, Math.floor(width * dpr));
    const pixelH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {
      w: width,
      h: height,
      cx: width * 0.5,
      cy: height * 0.48,
      s: Math.min(width, height),
      t: (performance.now() - started) / 1000,
      p: reduced() ? 1 : state.progress,
    };
  }

  function paint() {
    const box = frame();
    ctx.fillStyle = "#140c33";
    ctx.fillRect(0, 0, box.w, box.h);
    hairlines(box);
    const draw = scenes[state.name] || sceneHero;
    draw(box);
  }

  function loop() {
    measure();
    paint();
    if (!reduced()) raf = requestAnimationFrame(loop);
  }

  function onScroll() {
    measure();
    if (reduced()) paint();
  }

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    });
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    measure();
    paint();
  });
  if (document.fonts?.ready) {
    document.fonts.ready.then(paint);
  }
  reducedQuery.addEventListener("change", () => {
    cancelAnimationFrame(raf);
    if (reduced()) {
      measure();
      paint();
    } else {
      loop();
    }
  });

  loop();

  function hairlines(box) {
    ctx.strokeStyle = "rgba(58, 44, 134, 0.35)";
    ctx.lineWidth = 1;
    for (let y = 28; y < box.h; y += 44) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(box.w - 20, y);
      ctx.stroke();
    }
  }

  function ink(text, x, y, options) {
    const style = options || {};
    ctx.fillStyle = style.color || "#f4f1ff";
    ctx.font =
      (style.weight || 500) +
      " " +
      (style.size || 14) +
      "px " +
      (style.mono ? "Martian Mono, ui-monospace, monospace" : "Figtree, system-ui, sans-serif");
    ctx.textAlign = style.align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function caption(text) {
    ink(text, 24, 28, { align: "left", size: 12, mono: true, weight: 600, color: "#9d94c9" });
  }

  function flap(text, x, y, w, h, color) {
    const radius = 4;
    ctx.fillStyle = "#0f0a28";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = "#3a2c86";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#181040";
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h / 2 - 1, [radius, radius, 0, 0]);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 6, y + h / 2);
    ctx.lineTo(x + w - 6, y + h / 2);
    ctx.stroke();
    let size = Math.floor(h * 0.34);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${size}px Martian Mono, ui-monospace, monospace`;
    while (size > 9 && ctx.measureText(text).width > w - 16) {
      size -= 1;
      ctx.font = `600 ${size}px Martian Mono, ui-monospace, monospace`;
    }
    ctx.fillText(text, x + w / 2, y + h * 0.56);
  }

  function hexPath(x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function strokeHex(x, y, radius, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    hexPath(x, y, radius);
    ctx.stroke();
  }

  function chevron(x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(0, 0);
    ctx.lineTo(-8, 5);
    ctx.stroke();
    ctx.restore();
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = "#1e1450";
    ctx.strokeStyle = "#3a2c86";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();
  }

  function mover(x, y, letter, color) {
    ctx.fillStyle = "#1e1450";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ink(letter, x, y, { size: 12, mono: true, weight: 600, color: color });
  }

  function columnFlaps(box, items, progress, colorAt) {
    if (box.h < 340) {
      wrapFlaps(box, items, progress, colorAt);
      return;
    }
    const count = items.length;
    const gap = 8;
    const height = Math.min(44, (box.h - 64 - gap * (count - 1)) / count);
    const block = count * height + (count - 1) * gap;
    const width = Math.min(300, box.w - 40);
    const x = (box.w - width) / 2;
    const y = Math.max(36, (box.h - block) / 2);
    paintFlaps(items, progress, colorAt, x, y, width, height, 1, gap);
  }

  function wrapFlaps(box, items, progress, colorAt) {
    const cols = box.w < 460 ? 2 : 4;
    const rows = Math.ceil(items.length / cols);
    const gap = 8;
    const width = Math.min(160, (box.w - 28 - gap * (cols - 1)) / cols);
    const height = Math.min(40, (box.h - 52 - gap * (rows - 1)) / rows);
    const blockW = cols * width + (cols - 1) * gap;
    const blockH = rows * height + (rows - 1) * gap;
    const x = (box.w - blockW) / 2;
    const y = Math.max(34, (box.h - blockH) / 2);
    paintFlaps(items, progress, colorAt, x, y, width, height, cols, gap);
  }

  function paintFlaps(items, progress, colorAt, x, y, width, height, cols, gap) {
    const lit = progress >= 0.999 ? items.length : Math.max(1, Math.ceil(progress * items.length));
    for (let i = 0; i < items.length; i++) {
      flap(
        items[i],
        x + (i % cols) * (width + gap),
        y + Math.floor(i / cols) * (height + gap),
        width,
        height,
        i < lit ? colorAt(i) : "#9d94c9",
      );
    }
  }

  function sceneHero(box) {
    caption("ingenius 360");
    const breathe = reduced() ? 0 : Math.sin(box.t * 1.4) * 3;
    const spin = reduced() ? 0 : box.t * 0.08;
    const gap = 6;
    const rowW = Math.min(box.w - 36, box.h > 420 ? 460 : box.w * 0.9);
    const cell = (rowW - 7 * gap) / 8;
    const cellH = Math.min(cell * 1.22, Math.max(32, box.h * 0.36));
    const radius =
      Math.min(box.h * 0.4, box.w * 0.36, Math.max(cellH * 1.5, rowW * 0.46)) + breathe;
    const cy = clamp(box.h * 0.5, radius + 26, Math.max(radius + 26, box.h - 18));
    ctx.save();
    ctx.translate(box.cx, cy);
    ctx.rotate(spin);
    strokeHex(0, 0, radius, "#3a2c86", 1.5);
    strokeHex(0, 0, radius * 0.72, "#8851fa", 1.5);
    strokeHex(0, 0, radius * 0.4, "#4ade9a", 1.5);
    ctx.restore();
    const word = "INGENIUS";
    const shown = reduced() ? 8 : Math.min(8, Math.floor(Math.max(box.t * 6, box.p * 8)));
    const x0 = box.cx - rowW / 2;
    for (let i = 0; i < word.length; i++) {
      flap(
        i < shown ? word.charAt(i) : "",
        x0 + i * (cell + gap),
        cy - cellH / 2,
        cell,
        cellH,
        "#f4f1ff",
      );
    }
    const labelY = cy + radius + 22;
    if (labelY < box.h - 12) {
      ink("Hermes confirma la cita", box.cx, labelY, { size: 14, color: "#b9b0e0" });
    }
  }

  function sceneTalk(box) {
    caption("conversación");
    columnFlaps(
      box,
      ["Menú", "Documento", "Verificación", "Privacidad", "Registro", "Agenda", "Asesor"],
      box.p,
      (index) => {
        if (index === 2) return "#f2c94c";
        if (index === 6) return "#c8b0fb";
        return "#4ade9a";
      },
    );
  }

  function sceneSlot(box) {
    caption("cupo");
    const width = Math.min(250, box.w * 0.58);
    const height = Math.min(68, box.h * 0.14);
    const x = (box.w - width) / 2;
    const y = box.h * 0.34;
    const taken = box.p >= 0.5;
    flap(taken ? "busy_tentative" : "free", x, y, width, height, taken ? "#f2c94c" : "#4ade9a");
    const approach = ease(clamp(box.p / 0.5, 0, 1));
    const target = x - 20;
    mover(lerp(28, target, approach), y + height * 0.5, "A", taken ? "#4ade9a" : "#c8b0fb");
    const reject = ease(clamp((box.p - 0.5) / 0.45, 0, 1));
    mover(
      lerp(40, target - 6, approach),
      y + height * 0.5 + 26 + reject * 54,
      "B",
      box.p < 0.5 ? "#c8b0fb" : "#ff7a93",
    );
    if (box.p > 0.66) drawClock(box, x, y, width, height);
  }

  function drawClock(box, x, y, width, height) {
    const wide = box.w > 520;
    const cx = wide ? x + width + 36 : box.cx;
    const cy = wide ? y + height / 2 : y + height + 56;
    ctx.strokeStyle = "#3a2c86";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#f2c94c";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(-Math.PI / 2 + box.p * 6) * 12,
      cy + Math.sin(-Math.PI / 2 + box.p * 6) * 12,
    );
    ctx.stroke();
    ink("al leer", cx, cy + 30, { size: 11, mono: true, color: "#b9b0e0" });
  }

  function sceneHex(box) {
    caption("hexágono");
    const layers = [
      ["infrastructure", 0.4, "#9d94c9"],
      ["application", 0.27, "#c8b0fb"],
      ["domain", 0.15, "#4ade9a"],
    ];
    for (let i = 0; i < layers.length; i++) {
      const appear = clamp((box.p - i * 0.16) / 0.3, 0, 1);
      ctx.globalAlpha = 0.28 + appear * 0.72;
      strokeHex(box.cx, box.cy + 8, box.s * layers[i][1], layers[i][2], 1.75);
      ctx.globalAlpha = 1;
    }
    const inward = ease(clamp((box.p - 0.15) / 0.75, 0, 1));
    for (let k = 0; k < 6; k++) {
      const angle = -Math.PI / 2 + (k * Math.PI) / 3 + Math.PI / 6;
      const dist = lerp(box.s * 0.36, box.s * 0.1, inward);
      chevron(
        box.cx + Math.cos(angle) * dist,
        box.cy + 8 + Math.sin(angle) * dist,
        angle + Math.PI,
        "#8851fa",
      );
    }
    placeRingLabels(box, layers);
    if (box.p > 0.55) {
      ink("root", box.cx, box.cy + 8, { size: 12, mono: true, weight: 600, color: "#f4f1ff" });
    }
  }

  function placeRingLabels(box, layers) {
    if (box.w < 520 || box.h < 460) {
      for (let i = 0; i < layers.length; i++) {
        ink(layers[i][0], 24, box.h - 62 + i * 16, {
          align: "left",
          size: 11,
          mono: true,
          color: layers[i][2],
        });
      }
      return;
    }
    for (let n = 0; n < layers.length; n++) {
      const radius = box.s * layers[n][1];
      ink(layers[n][0], box.cx, box.cy + 8 - radius - 14, {
        size: 12,
        mono: true,
        color: layers[n][2],
      });
    }
  }

  function sceneContracts(box) {
    caption("contratos");
    if (box.w >= 460) drawContractColumns(box);
    else drawContractStack(box);
    ink("no se cruzan", box.cx, box.h - 36, { size: 12, mono: true, color: "#ff7a93" });
  }

  function drawContractColumns(box) {
    const gap = 18;
    const width = Math.min(190, (box.w - 64 - gap) / 2);
    const height = Math.min(230, box.h * 0.48);
    const y = box.cy - height / 2;
    const left = box.cx - gap / 2 - width;
    const right = box.cx + gap / 2;
    contractCard(
      left,
      y,
      width,
      height,
      "REST",
      "/api/v1",
      ["code", "message", "request_id"],
      box.p,
    );
    contractCard(
      right,
      y,
      width,
      height,
      "FHIR",
      "/fhir",
      ["OperationOutcome", "Appointment", "Task"],
      box.p,
    );
    ctx.strokeStyle = "#ff7a93";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(box.cx, y - 8);
    ctx.lineTo(box.cx, y + height + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawContractStack(box) {
    const width = Math.min(260, box.w - 40);
    const height = Math.min(120, box.h * 0.24);
    const x = (box.w - width) / 2;
    contractCard(x, box.h * 0.22, width, height, "REST", "/api/v1", ["code", "request_id"], box.p);
    contractCard(
      x,
      box.h * 0.22 + height + 16,
      width,
      height,
      "FHIR",
      "/fhir",
      ["OperationOutcome"],
      box.p,
    );
  }

  function contractCard(x, y, w, h, title, path, lines, progress) {
    panel(x, y, w, h);
    const compact = h < 150;
    ink(title, x + w / 2, y + (compact ? 18 : 26), {
      size: 13,
      mono: true,
      weight: 600,
      color: "#c8b0fb",
    });
    ink(path, x + w / 2, y + (compact ? 36 : 46), { size: 11, mono: true, color: "#9d94c9" });
    if (compact) return;
    for (let i = 0; i < lines.length; i++) {
      if (progress < 0.12 + i * 0.16) continue;
      ink(lines[i], x + w / 2, y + 78 + i * 26, { size: 12, mono: true, color: "#f4f1ff" });
    }
  }

  function sceneBuild(box) {
    caption("construcción");
    const phases = ["Cimientos", "Dominio", "Chat", "FHIR", "Entrega"];
    const top = box.cy - (phases.length * 36) / 2;
    const left = Math.max(28, box.cx - 150);
    for (let i = 0; i < phases.length; i++) {
      const local = clamp(box.p * phases.length - i, 0, 1);
      ctx.fillStyle = "#271a63";
      ctx.fillRect(left, top + i * 36, 120, 8);
      ctx.fillStyle = "#8851fa";
      ctx.fillRect(left, top + i * 36, 120 * ease(local), 8);
      ink(phases[i], left + 132, top + i * 36 + 4, {
        align: "left",
        size: 13,
        color: local > 0.05 ? "#f4f1ff" : "#9d94c9",
      });
    }
    if (box.w > 560) drawStack(box);
  }

  function drawStack(box) {
    const names = ["Next.js", "Prisma", "Postgres", "Docker", "Biome", "Vitest"];
    const x = box.w - 120;
    for (let i = 0; i < names.length; i++) {
      if (box.p < i / names.length) continue;
      ink(names[i], x, box.cy - 90 + i * 28, { size: 12, mono: true, color: "#b9b0e0" });
    }
  }

  function sceneHarness(box) {
    caption("arneses");
    const radius = box.s * 0.34;
    strokeHex(box.cx, box.cy, radius, "#8851fa", 2);
    ink("gobernanza", box.cx, box.cy - radius - 18, {
      size: 13,
      mono: true,
      weight: 600,
      color: "#c8b0fb",
    });
    const skills = ["hexágono", "FHIR", "seguridad", "UI", "DRY", "SDD"];
    for (let i = 0; i < skills.length; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / skills.length;
      const dist = radius * 0.58;
      const visible = box.p >= i / skills.length;
      ctx.globalAlpha = visible ? 1 : 0.35;
      ctx.fillStyle = "#271a63";
      ctx.beginPath();
      ctx.arc(box.cx + Math.cos(angle) * dist, box.cy + Math.sin(angle) * dist, 18, 0, Math.PI * 2);
      ctx.fill();
      ink(skills[i], box.cx + Math.cos(angle) * dist, box.cy + Math.sin(angle) * dist, {
        size: 9,
        mono: true,
        color: "#f4f1ff",
      });
      ctx.globalAlpha = 1;
    }
    if (box.p > 0.62) {
      ink("adapters", box.cx, box.cy + radius + 22, { size: 12, mono: true, color: "#ff7a93" });
      ink("infrastructure", box.cx, box.cy + radius + 40, {
        size: 12,
        mono: true,
        color: "#4ade9a",
      });
    }
  }

  function sceneGates(box) {
    caption("puertas");
    columnFlaps(
      box,
      ["biome", "tipos", "vitest", "doctor", "openapi", "metadata"],
      box.p,
      () => "#4ade9a",
    );
  }
})();
