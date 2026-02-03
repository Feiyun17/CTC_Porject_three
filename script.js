(() => {
  const body = document.body;

  // 只改这个词的颜色（HTML 里：<span id="doorAnchor">Feiyun’s</span>）
  const anchorEl = document.getElementById("doorAnchor");

  const canvas = document.getElementById("fx");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });

  let W = window.innerWidth;
  let H = window.innerHeight;

  // 一开始没门没线：第一次滚动才出现
  let pAppear = 0;

  // 线宽（手机更细）
  let lineWidth = 1.5;
  function updateLineWidth() {
    lineWidth = (W <= 520) ? 1.1 : 1.5;
  }

  // 门中心：由 Feiyun’s 的位置决定
  let doorCX = null;
  let doorWOverride = null;

  function computeDoorAnchor() {
    if (!anchorEl) { doorCX = null; doorWOverride = null; return; }
    const r = anchorEl.getBoundingClientRect();
    doorCX = r.left + r.width * 0.5;

    // 门宽：贴近 Feiyun’s 的宽度（类似你黄框）
    const pad = Math.max(6, r.width * 0.06);
    doorWOverride = r.width + pad * 2;
  }

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateLineWidth();
    computeDoorAnchor();
  }
  window.addEventListener("resize", resize);
  resize();

  // 字体加载后再算一次（避免 anchor 位置抖）
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => computeDoorAnchor());
  } else {
    setTimeout(computeDoorAnchor, 80);
  }

  // tools
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /* mouse（用于白线波动） */
  let mouseX = W * 0.5;
  let prevMouseX = mouseX;
  window.addEventListener("pointermove", (e) => (mouseX = e.clientX), { passive: true });

  /* scroll momentum */
  let scrollMomentum = 0;
  let scrollDir = 1;
  let lastScrollY = window.scrollY;

  /* progress */
  let pDoor = 0;      // 开门进度
  let pBlack = 0;     // 全屏变黑
  let pWhite = 0;     // 白线波动进度（在黑底阶段）
  let doorInnerA = 0; // 门内变黑强度（驱动 Feiyun’s 变白）

  /* hover feedback for tail items */
  let hoverX01 = null;       // 0~1
  let hoverStrength = 0;     // 0~1 平滑
  function setHoverByEl(el, on){
    if (!el) return;
    if (!on) { hoverX01 = null; return; }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width * 0.5;
    hoverX01 = clamp01(cx / W);
  }

  // 监听尾页链接 hover，让白线在对应位置轻微“呼吸”
  function bindTailHover(){
    const items = document.querySelectorAll(".tailItem");
    if (!items || items.length === 0) return;
    items.forEach((el) => {
      el.addEventListener("mouseenter", () => setHoverByEl(el, true));
      el.addEventListener("mouseleave", () => setHoverByEl(el, false));
      // 移动端：touchstart 也给一点反馈
      el.addEventListener("touchstart", () => setHoverByEl(el, true), { passive: true });
      el.addEventListener("touchend", () => setHoverByEl(el, false), { passive: true });
    });
  }
  // DOM ready 后绑定
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindTailHover);
  } else {
    bindTailHover();
  }

  /* wave arrays */
  const N = 440;
  const yWhite = new Float32Array(N);
  const vWhite = new Float32Array(N);

  const spring = 0.0105;
  const damp = 0.948;
  const spread = 0.110;

  // 原黑线位置
  const baseY = () => H * 0.52;

  function injectRippleAt(yArr, vArr, xNorm01, amount, radius) {
    const idx = Math.round(xNorm01 * (N - 1));
    const i0 = Math.max(0, Math.min(N - 1, idx));
    for (let k = -radius; k <= radius; k++) {
      const i = i0 + k;
      if (i < 0 || i >= N) continue;
      const d = k / radius;
      const w = Math.exp(-d * d * 2.0);
      vArr[i] += amount * w;
    }
  }

  function simulateWater(yArr, vArr, p) {
    const waveSpeed = lerp(0.65, 1.55, smoothstep(0.18, 0.95, p));
    const steps = waveSpeed > 1.2 ? 3 : 2;

    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < N; i++) {
        vArr[i] += -yArr[i] * spring;
        vArr[i] *= damp;
        yArr[i] += vArr[i];
      }
      for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < N; i++) {
          const left = i > 0 ? yArr[i - 1] : yArr[i];
          const right = i < N - 1 ? yArr[i + 1] : yArr[i];
          vArr[i] += (left + right - 2 * yArr[i]) * spread;
        }
      }
    }
  }

  function strokeSmoothPolyline(yArr, start, end, amp) {
    const y0 = baseY();
    ctx.beginPath();
    let first = true;
    let prevX = 0, prevY = 0;

    for (let i = start; i <= end; i++) {
      const x = (i / (N - 1)) * W;
      const yy = y0 + yArr[i] * amp;
      if (first) {
        ctx.moveTo(x, yy);
        first = false;
        prevX = x; prevY = yy;
      } else {
        const cx = (prevX + x) * 0.5;
        const cy = (prevY + yy) * 0.5;
        ctx.quadraticCurveTo(prevX, prevY, cx, cy);
        prevX = x; prevY = yy;
      }
    }
    ctx.stroke();
  }

  function getCenterSegmentByProgress(p) {
    const appear = smoothstep(0.02, 0.12, p);
    const grow = Math.pow(appear, 1.08);
    const halfCount = Math.floor(((N - 1) * 0.5) * grow);
    const mid = Math.floor((N - 1) * 0.5);
    return {
      appear,
      start: Math.max(0, mid - halfCount),
      end: Math.min(N - 1, mid + halfCount),
    };
  }

  // mapping
  const doorSpan = () => window.innerHeight * 0.95;
  const blackSpan = () => window.innerHeight * 0.75;

  function updateProgress() {
    const y = window.scrollY;

    // 第一次滚动才出现门/线
    const appearSpan = window.innerHeight * 0.25;
    pAppear = clamp01(y / appearSpan);

    // momentum
    const dy = y - lastScrollY;
    lastScrollY = y;
    if (Math.abs(dy) > 0.2) {
      scrollDir = dy >= 0 ? 1 : -1;
      const speed01 = clamp01(Math.abs(dy) / 80);
      scrollMomentum = clamp01(scrollMomentum + speed01 * 0.35);
    }
    scrollMomentum = lerp(scrollMomentum, 0, 0.035);

    // door open
    const doorTarget = clamp01(y / doorSpan());

    // black after door
    const blackLocal = Math.max(0, y - doorSpan());
    const blackTarget = clamp01(blackLocal / blackSpan());

    // white wave appears later
    const whiteTarget = clamp01(smoothstep(0.20, 0.90, blackTarget));

    pDoor  = lerp(pDoor,  doorTarget,  0.085);
    pBlack = lerp(pBlack, blackTarget, 0.165);
    pWhite = lerp(pWhite, whiteTarget, 0.095);

    // Hi 淡出
    if (pBlack > 0.06) body.classList.add("fx-start");
    else body.classList.remove("fx-start");

    // ✅ 完全黑后才出现 BOUNDARY
    if (pBlack > 0.985 && pWhite > 0.75) body.classList.add("tail-ready");
    else body.classList.remove("tail-ready");
  }

  // ✅ 黑线 -> 白线：屏幕变黑时同一条线逐渐变白
  function drawMorphLine() {
    if (pAppear <= 0.001) return;

    const yLine = baseY();

    const t = smoothstep(0.05, 0.65, pBlack);
    const c = Math.round(255 * t);
    const a = (0.75 + 0.20 * t) * pAppear;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = `rgba(${c},${c},${c},${a})`;

    ctx.beginPath();
    ctx.moveTo(0, yLine);
    ctx.lineTo(W, yLine);
    ctx.stroke();
  }

  // ✅ 门（无厚度无阴影）：门框 + 门扇轮廓 + 门内黑 + 把手（跟门走）
  function drawDoor(p) {
    if (pAppear <= 0.001) return;

    const yLine = baseY();
    const cx = (doorCX != null) ? doorCX : (W * 0.5);

    const doorW = Math.min(220, Math.max(96, doorWOverride ?? 150));

    // ✅ 门稍微矮一点（你要“稍微低一点”）
    const doorH = Math.min(500, Math.max(300, doorW * 1.72));

    const bottomY = yLine;
    const topY = bottomY - doorH;
    const leftX = cx - doorW * 0.5;

    // 门框
    ctx.lineWidth = Math.max(1, lineWidth * 0.9);
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * pAppear})`;
    ctx.beginPath();
    ctx.rect(leftX, topY, doorW, doorH);
    ctx.stroke();

    // 开门角度
    const tt = easeOutCubic(p);
    const ang = tt * (Math.PI / 2) * 0.92;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);

    // 门扇四边形（铰链在左）
    const xR = leftX + doorW * cosA;
    const skew = doorW * sinA * 0.14;

    const P0 = { x: leftX, y: topY };          // hinge top
    const P3 = { x: leftX, y: bottomY };       // hinge bottom
    const P1 = { x: xR,   y: topY - skew };    // free top
    const P2 = { x: xR,   y: bottomY + skew }; // free bottom

    // 门内变黑强度（驱动 Feiyun’s 变白）
    doorInnerA = smoothstep(0.10, 0.85, p) * pAppear;

    // 门内黑（矩形填充）
    if (doorInnerA > 0.001) {
      ctx.fillStyle = `rgba(0,0,0,${0.92 * doorInnerA})`;
      ctx.fillRect(leftX + 1.0, topY + 1.0, doorW - 2.0, doorH - 2.0);
    }

    // 门扇轮廓（无厚度）
    ctx.strokeStyle = `rgba(0,0,0,${0.42 * pAppear})`;
    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    ctx.lineTo(P1.x, P1.y);
    ctx.lineTo(P2.x, P2.y);
    ctx.lineTo(P3.x, P3.y);
    ctx.closePath();
    ctx.stroke();

    // ✅ 把手：黑色实心圆，位置更靠右 + 更靠下，并跟门扇走
    const u = 0.74;  // 更靠右
    const v = 0.66;  // 更靠下

    const hx =
      (1 - u) * (1 - v) * P0.x +
      u       * (1 - v) * P1.x +
      u       * v       * P2.x +
      (1 - u) * v       * P3.x;

    const hy =
      (1 - u) * (1 - v) * P0.y +
      u       * (1 - v) * P1.y +
      u       * v       * P2.y +
      (1 - u) * v       * P3.y;

    const r = Math.max(3, doorW * 0.022);

    ctx.fillStyle = `rgba(0,0,0,${0.78 * pAppear})`;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateAnchorColor() {
    if (!anchorEl) return;
    // ✅ 只在门开始变黑时才慢慢变白（慢一点）
    const t = Math.pow(clamp01(doorInnerA), 1.25);
    const c = Math.round(255 * t);
    anchorEl.style.color = `rgb(${c},${c},${c})`;
  }

  function frame() {
    requestAnimationFrame(frame);

    updateProgress();
    ctx.clearRect(0, 0, W, H);

    // 白底阶段：门可见
    const doorVis = (1.0 - smoothstep(0.0, 0.55, pBlack));

    if (doorVis > 0.001 && pAppear > 0.001) {
      computeDoorAnchor();

      // 线：黑->白过渡（同一条线）
      ctx.save();
      ctx.globalAlpha = doorVis;
      drawMorphLine();
      ctx.restore();

      // 门：盖在线上方
      ctx.save();
      ctx.globalAlpha = doorVis * pAppear;
      drawDoor(pDoor);
      ctx.restore();
    } else {
      doorInnerA = lerp(doorInnerA, 0, 0.12);
    }

    // 全屏变黑
    if (pBlack > 0.0001) {
      const k = Math.pow(smoothstep(0.0, 1.0, pBlack), 1.06);
      ctx.fillStyle = `rgba(0,0,0,${k})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 黑底阶段：波动白线（你的原算法）
    const segWhite = getCenterSegmentByProgress(pWhite);
    if (segWhite.appear > 0.0001) {
      const mouseSpeed = Math.min(80, Math.abs(mouseX - prevMouseX));
      prevMouseX = mouseX;
      const mouse01 = clamp01(mouseSpeed / 55);

      // 鼠标注入
      if (mouse01 > 0.01) {
        const radius = Math.floor(lerp(16, 60, smoothstep(0.20, 0.95, pWhite)));
        const amount = mouse01 * (0.014 + 0.020 * smoothstep(0.18, 0.95, pWhite));
        const dir = Math.sin(performance.now() * 0.01) > 0 ? 1 : -1;
        injectRippleAt(yWhite, vWhite, clamp01(mouseX / W), amount * dir, radius);
      }

      // ✅ hover 空间反馈（克制）：在 hover 的项目 x 位置轻微注入小波
      const hoverTarget = (hoverX01 != null) ? 1 : 0;
      hoverStrength = lerp(hoverStrength, hoverTarget, 0.08);

      if (hoverStrength > 0.001 && hoverX01 != null) {
        const pulse = Math.sin(performance.now() * 0.004);
        const amt = (0.0065 + 0.0035 * pulse) * hoverStrength * smoothstep(0.55, 1.0, pBlack);
        const rad = Math.floor(lerp(18, 36, hoverStrength));
        injectRippleAt(yWhite, vWhite, hoverX01, amt, rad);
      }

      simulateWater(yWhite, vWhite, pWhite);

      const ampWhite = lerp(2, H * 0.18, smoothstep(0.10, 1.0, pWhite));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      strokeSmoothPolyline(yWhite, segWhite.start, segWhite.end, ampWhite);
    }

    // 只变 Feiyun’s
    updateAnchorColor();
  }

  frame();
})();
