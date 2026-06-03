/* ════════════════════════════════════════════════════════════════════
   NEXUS — Immersive landing engine
   Zero-dependency. Custom canvas 3D particle field + nebula + interactions.
   ════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none)').matches;

  /* ───────────────────────── BOOT SEQUENCE ───────────────────────── */
  (function boot() {
    const boot = document.getElementById('boot');
    const bar = document.getElementById('bootBar');
    const label = document.getElementById('bootLabel');
    const phases = [
      'Initializing universe',
      'Mounting encrypted vault',
      'Calibrating particle field',
      'Synchronizing relay',
      'Rendering in light',
    ];
    let p = 0,
      pi = 0;
    const tick = () => {
      p = Math.min(100, p + Math.random() * 16 + 6);
      bar.style.width = p + '%';
      const ni = Math.min(phases.length - 1, Math.floor(p / 20));
      if (ni !== pi) {
        pi = ni;
        label.textContent = phases[ni];
      }
      if (p < 100) {
        setTimeout(tick, 160 + Math.random() * 120);
      } else {
        label.textContent = 'Entering';
        setTimeout(() => {
          boot.classList.add('gone');
          document.documentElement.dispatchEvent(new Event('nexus:enter'));
        }, 360);
      }
    };
    if (reduceMotion) {
      bar.style.width = '100%';
      setTimeout(() => boot.classList.add('gone'), 200);
    } else {
      setTimeout(tick, 240);
    }
  })();

  /* ───────────────────────── NEBULA (drifting aurora) ───────────────────────── */
  (function nebula() {
    const c = document.getElementById('nebula');
    const ctx = c.getContext('2d');
    let w, h, dpr;
    const blobs = [];
    const palette = [
      [34, 211, 238],
      [99, 102, 241],
      [168, 85, 247],
      [224, 64, 251],
      [79, 124, 255],
    ];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      w = c.width = innerWidth * dpr;
      h = c.height = innerHeight * dpr;
      c.style.width = innerWidth + 'px';
      c.style.height = innerHeight + 'px';
    }
    resize();
    addEventListener('resize', resize);

    for (let i = 0; i < 6; i++) {
      const col = palette[i % palette.length];
      blobs.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.28 + Math.random() * 0.34,
        dx: (Math.random() - 0.5) * 0.00007,
        dy: (Math.random() - 0.5) * 0.00007,
        col,
        ph: Math.random() * Math.PI * 2,
      });
    }

    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      t += 0.004;
      for (const b of blobs) {
        if (!reduceMotion) {
          b.x += b.dx;
          b.y += b.dy;
          if (b.x < -0.2 || b.x > 1.2) b.dx *= -1;
          if (b.y < -0.2 || b.y > 1.2) b.dy *= -1;
        }
        const px = b.x * w;
        const py = b.y * h;
        const pr = b.r * Math.min(w, h) * (1 + 0.08 * Math.sin(t + b.ph));
        const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
        const [r, gg, bl] = b.col;
        g.addColorStop(0, `rgba(${r},${gg},${bl},0.16)`);
        g.addColorStop(0.5, `rgba(${r},${gg},${bl},0.05)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(draw);
    }
    if (reduceMotion) {
      draw();
    } else {
      draw();
    }
  })();

  /* ───────────────────────── 3D PARTICLE CONSTELLATION ─────────────────────────
     A rotating point-cloud projected with a simple perspective camera.
     Points form a layered shell ("nexus core") plus an ambient star field.
     Nearby points are linked with depth-faded neon lines (constellation).
     The camera yaw/pitch eases toward the pointer for a cinematic parallax.
  ──────────────────────────────────────────────────────────────────────────── */
  (function constellation() {
    const c = document.getElementById('fx');
    const ctx = c.getContext('2d');
    let w, h, dpr, cx, cy;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = c.width = innerWidth * dpr;
      h = c.height = innerHeight * dpr;
      c.style.width = innerWidth + 'px';
      c.style.height = innerHeight + 'px';
      cx = w / 2;
      cy = h / 2;
    }
    resize();
    addEventListener('resize', resize);

    const COUNT = innerWidth < 720 ? 150 : innerWidth < 1200 ? 260 : 380;
    const FOCAL = 720 * dpr;
    const pts = [];

    // Fibonacci sphere shell + scattered ambient cloud
    const SHELL = Math.floor(COUNT * 0.55);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      let x, y, z, shell;
      if (i < SHELL) {
        shell = true;
        const yy = 1 - (i / (SHELL - 1)) * 2;
        const rad = Math.sqrt(1 - yy * yy);
        const th = golden * i;
        const R = 230 + Math.random() * 30;
        x = Math.cos(th) * rad * R;
        y = yy * R;
        z = Math.sin(th) * rad * R;
      } else {
        shell = false;
        const R = 360 + Math.random() * 520;
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(Math.random() * 2 - 1);
        x = Math.sin(b) * Math.cos(a) * R;
        y = Math.sin(b) * Math.sin(a) * R;
        z = Math.cos(b) * R;
      }
      // color by quadrant for variety: cyan / violet / azure / magenta
      const hueSel = Math.random();
      let col;
      if (hueSel < 0.34) col = [34, 211, 238];
      else if (hueSel < 0.62) col = [99, 102, 241];
      else if (hueSel < 0.84) col = [168, 85, 247];
      else col = [224, 64, 251];
      pts.push({ x, y, z, shell, col, tw: Math.random() * Math.PI * 2 });
    }

    // camera state
    let yaw = 0,
      pitch = 0,
      targetYaw = 0,
      targetPitch = 0,
      autoYaw = 0;
    let scrollDepth = 0;

    // pointer drives target camera angles
    if (!isTouch) {
      addEventListener('pointermove', (e) => {
        targetYaw = (e.clientX / innerWidth - 0.5) * 0.6;
        targetPitch = (e.clientY / innerHeight - 0.5) * 0.5;
      });
    } else {
      addEventListener(
        'deviceorientation',
        (e) => {
          if (e.gamma != null) {
            targetYaw = (e.gamma / 90) * 0.5;
            targetPitch = (e.beta / 90) * 0.3;
          }
        },
        true
      );
    }
    addEventListener(
      'scroll',
      () => {
        const max = document.body.scrollHeight - innerHeight;
        scrollDepth = max > 0 ? scrollTop() / max : 0;
      },
      { passive: true }
    );
    function scrollTop() {
      return window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    const LINK_DIST = (innerWidth < 720 ? 90 : 118) * dpr;
    const LINK_DIST2 = LINK_DIST * LINK_DIST;
    let frame = 0;

    function render() {
      frame++;
      ctx.clearRect(0, 0, w, h);

      // ease camera
      yaw += (targetYaw - yaw) * 0.045;
      pitch += (targetPitch - pitch) * 0.045;
      if (!reduceMotion) autoYaw += 0.0016;

      const sinY = Math.sin(yaw + autoYaw),
        cosY = Math.cos(yaw + autoYaw);
      const sinP = Math.sin(pitch),
        cosP = Math.cos(pitch);

      // depth pull from scroll: descend "into" the field
      const camZ = -120 + scrollDepth * 520;
      const yShift = scrollDepth * 140 * dpr;

      const proj = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        // rotate around Y then X
        let x = p.x * cosY - p.z * sinY;
        let z = p.x * sinY + p.z * cosY;
        let y = p.y * cosP - z * sinP;
        z = p.y * sinP + z * cosP;
        z += camZ;
        const zc = z + 900;
        if (zc <= 1) {
          proj.push(null);
          continue;
        }
        const scale = FOCAL / zc;
        const sx = cx + x * scale * dpr * 0.5;
        const sy = cy + y * scale * dpr * 0.5 - yShift;
        const depth = Math.max(0, Math.min(1, 1 - (zc - 200) / 1600));
        proj.push({ sx, sy, depth, scale, p });
      }

      // links — only between shell points that are close on screen
      ctx.lineWidth = 1 * dpr;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i];
        if (!a || !a.p.shell) continue;
        for (let j = i + 1; j < proj.length; j++) {
          const b = proj[j];
          if (!b || !b.p.shell) continue;
          const dx = a.sx - b.sx,
            dy = a.sy - b.sy;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST2) {
            const t = 1 - d2 / LINK_DIST2;
            const al = t * 0.32 * Math.min(a.depth, b.depth);
            if (al < 0.012) continue;
            const col = a.p.col;
            ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${al})`;
            ctx.beginPath();
            ctx.moveTo(a.sx, a.sy);
            ctx.lineTo(b.sx, b.sy);
            ctx.stroke();
          }
        }
      }

      // points
      for (let i = 0; i < proj.length; i++) {
        const pr = proj[i];
        if (!pr) continue;
        const p = pr.p;
        const tw = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(frame * 0.03 + p.tw);
        const r = (p.shell ? 1.7 : 1.0) * pr.scale * dpr * (0.6 + tw * 0.6);
        const al = pr.depth * (p.shell ? 0.95 : 0.7) * (0.5 + tw * 0.5);
        if (al < 0.02 || r < 0.15) continue;
        const col = p.col;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${al})`;
        ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2);
        ctx.fill();
        // glow for bright shell points
        if (p.shell && pr.depth > 0.6 && tw > 0.7) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${al * 0.12})`;
          ctx.arc(pr.sx, pr.sy, r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      requestAnimationFrame(render);
    }
    render();
  })();

  /* ───────────────────────── CUSTOM CURSOR ───────────────────────── */
  if (!isTouch) {
    const dot = document.getElementById('cDot');
    const ring = document.getElementById('cRing');
    let mx = innerWidth / 2,
      my = innerHeight / 2,
      rx = mx,
      ry = my;
    addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
    });
    (function follow() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(follow);
    })();
    const hot = 'a, button, .btn, .card, .mail, [data-tilt]';
    document.addEventListener('pointerover', (e) => {
      if (e.target.closest(hot)) ring.classList.add('hot');
    });
    document.addEventListener('pointerout', (e) => {
      if (e.target.closest(hot)) ring.classList.remove('hot');
    });
  }

  /* ───────────────────────── SCROLL PROGRESS + NAV DOCK ───────────────────────── */
  (function scrollUI() {
    const fill = document.getElementById('scrollFill');
    const nav = document.getElementById('nav');
    function onScroll() {
      const max = document.body.scrollHeight - innerHeight;
      const t = max > 0 ? (window.pageYOffset / max) * 100 : 0;
      fill.style.width = t + '%';
      nav.classList.toggle('docked', window.pageYOffset > 40);
    }
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ───────────────────────── REVEAL ON SCROLL ───────────────────────── */
  (function reveal() {
    const els = document.querySelectorAll('.reveal-up');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -8% 0px' }
    );
    els.forEach((e) => io.observe(e));
  })();

  /* ───────────────────────── HERO TITLE REVEAL ───────────────────────── */
  document.documentElement.addEventListener('nexus:enter', () => {
    const lines = document.querySelectorAll('[data-reveal]');
    lines.forEach((l, i) => {
      l.style.transition = 'transform 1s cubic-bezier(0.16,1,0.3,1)';
      l.style.transitionDelay = 0.1 + i * 0.12 + 's';
      requestAnimationFrame(() => (l.style.transform = 'translateY(0)'));
    });
  });
  // fallback: guarantee the hero title is visible even if the boot event is missed
  setTimeout(() => {
    document.querySelectorAll('[data-reveal]').forEach((l) => {
      l.style.transform = 'translateY(0)';
    });
  }, 2600);

  /* ───────────────────────── 3D TILT (holo panels) ───────────────────────── */
  if (!isTouch && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(1400px) rotateY(${px * 8}deg) rotateX(${-py * 8}deg) translateZ(0)`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.transform = 'perspective(1400px) rotateY(0) rotateX(0)';
      });
    });
  }

  /* ───────────────────────── CARD GLOW TRACKING ───────────────────────── */
  if (!isTouch) {
    document.querySelectorAll('[data-glow]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', e.clientX - r.left + 'px');
        el.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
  }

  /* ───────────────────────── SPARKLINES (holo floats) ───────────────────────── */
  (function sparks() {
    [
      ['spark1', [40, 55, 48, 70, 62, 85, 78, 96]],
      ['spark2', [80, 60, 72, 50, 62, 40, 52, 34]],
    ].forEach(([id, vals]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = vals
        .map((v) => `<i style="height:${v}%"></i>`)
        .join('');
    });
  })();
})();
