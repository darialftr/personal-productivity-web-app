"use strict";
/* Deliberately canvas-first: one active page, rAF drawing and debounced compact data saves. */
(function (global) {
  let root,
    canvas,
    ctx,
    subject,
    user,
    notebook,
    activePage = 0,
    tool = "gel",
    color = "#4d4260",
    width = 3;
  let drawing = null,
    redo = [],
    saveTimer = 0,
    frame = 0,
    mounted = false,
    zoom = 1,
    pan = { x: 0, y: 0 },
    saveVersion = 0,
    autoShapes = false,
    shapeTool = "",
    saving = false,
    saveQueued = false,
    penPointerId = null;
  const pointers = new Map();
  const images = new Map();
  const key = () =>
    `itera:notebook:${user?.id || "guest"}:${subject?.id || "subject"}`;
  const templates = {
    lined: "Liniat",
    grid: "Pătrățele",
    blank: "Simplu",
  };
  const palette = [
    "#4d4260",
    "#5f698f",
    "#4e8173",
    "#a65f72",
    "#b77946",
    "#6f5795",
    "#25324a",
    "#171717",
  ];
  const fresh = () => ({
    version: 3,
    pages: [
      {
        template: "lined",
        background: "#fffdf9",
        orientation: "portrait",
        strokes: [],
        elements: [],
      },
    ],
    updatedAt: Date.now(),
  });
  const page = () => notebook.pages[activePage];
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(key()) || "null");
      return saved?.pages?.length ? saved : fresh();
    } catch (_) {
      return fresh();
    }
  }
  async function loadCloud() {
    const { data, error } = await supabaseClient
      .from("notebooks")
      .select("content,updated_at")
      .eq("user_id", user.id)
      .eq("subject_id", subject.id)
      .maybeSingle();
    if (
      error ||
      !data?.content?.pages?.length ||
      !mounted
    ) {
      return;
    }
    if (
      Number(data.content.updatedAt || 0) >
      Number(notebook.updatedAt || 0)
    ) {
      notebook = data.content;
      notebook.pages.forEach((item) => {
        item.strokes ||= [];
        item.elements ||= [];
        item.background ||= "#fffdf9";
        item.orientation ||= "portrait";
      });
      render();
    }
    updateStatus("Sincronizat");
  }
  
let saveQuietTimer = 0;
let saveIdleHandle = 0;

function cancelScheduledSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;

  clearTimeout(saveQuietTimer);
  saveQuietTimer = 0;

  if (
    saveIdleHandle &&
    typeof global.cancelIdleCallback === "function"
  ) {
    global.cancelIdleCallback(saveIdleHandle);
  }

  saveIdleHandle = 0;
}

function isUserInteracting() {
  return (
    pointers.size > 0 ||
    drawing !== null ||
    penPointerId !== null
  );
}

function scheduleNotebookSave() {
  clearTimeout(saveQuietTimer);
  saveQuietTimer = 0;

  if (saveIdleHandle) {
    if (
      typeof global.cancelIdleCallback === "function"
    ) {
      global.cancelIdleCallback(saveIdleHandle);
    } else {
      global.clearTimeout(saveIdleHandle);
    }

    saveIdleHandle = 0;
  }

  saveQueued = true;

  saveQuietTimer = global.setTimeout(() => {
    saveQuietTimer = 0;

    if (isUserInteracting()) {
      return;
    }

    const save = () => {
      saveIdleHandle = 0;

      if (isUserInteracting()) {
        return;
      }

      void persist();
    };

    if (
      typeof global.requestIdleCallback === "function"
    ) {
      saveIdleHandle = global.requestIdleCallback(
        save,
        { timeout: 5000 }
      );
    } else {
      saveIdleHandle = global.setTimeout(save, 0);
    }
  }, 2000);
}

function saveSoon() {
  scheduleNotebookSave();
}


  async function persist() {
    if (!notebook || !user || !subject) return;
    if (isUserInteracting()) {
      saveQueued = true;
      return;
    }
    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    do {
      saveQueued = false;
      if (isUserInteracting()) {
        saveQueued = true;
        break;
      }

      const version = ++saveVersion;
      notebook.updatedAt = Date.now();

      let snapshot;
      try {
        snapshot =
          typeof structuredClone === "function"
            ? structuredClone(notebook)
            : JSON.parse(JSON.stringify(notebook));
      } catch (_) {
        saving = false;
        updateStatus("Eroare la pregătirea salvării");
        return;
      }

      if (isUserInteracting()) {
        saveQueued = true;
        break;
      }

      let error = null;
      try {
        const result = await supabaseClient
          .from("notebooks")
          .upsert(
            {
              user_id: user.id,
              subject_id: subject.id,
              content: snapshot,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,subject_id" }
          );
        error = result.error || null;
      } catch (_) {
        error = new Error("Supabase save failed");
      }

      if (version !== saveVersion) {
        saveQueued = true;
      }

      if (
        mounted &&
        version === saveVersion &&
        !saveQueued &&
        !isUserInteracting()
      ) {
        updateStatus(
          error
            ? "Salvat local — sincronizarea va fi reluată"
            : "Salvat și sincronizat"
        );
      }
    } while (
      saveQueued &&
      notebook &&
      user &&
      subject &&
      !isUserInteracting()
    );

    saving = false;

    if (saveQueued && mounted && !isUserInteracting()) {
      saveSoon();
    }
  }

  function updateStatus(text) {
    root
      ?.querySelector("[data-notebook-status]")
      ?.replaceChildren(text);
  }

  async function mount(subjectId) {
    root = document.getElementById("notebookViewRoot");
    if (!root) return;
    mounted = true;
    root.innerHTML =
      '<div class="subjects-spa-state">Se deschide caietul…</div>';
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    user = session?.user;
    if (!user || !mounted) return;
    const { data } = await supabaseClient
      .from("subjects")
      .select("id,name,color")
      .eq("id", subjectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data || !mounted) {
      root.innerHTML =
        '<div class="subjects-spa-state">Caietul nu a fost găsit.</div>';
      return;
    }
    subject = data;
    notebook = load();
    notebook.pages.forEach((item) => {
      item.strokes ||= [];
      item.elements ||= [];
      item.background ||= "#fffdf9";
      item.orientation ||= "portrait";
    });
    activePage = 0;
    redo = [];
    zoom = 1;
    pan = { x: 0, y: 0 };
    render();
    void loadCloud();
  }

  function unmount() {
    cancelScheduledSave();
    if (notebook) {
      void persist();
    }
    mounted = false;
    root = canvas = ctx = drawing = null;
    pointers.clear();
  }

  function desk() {
    return `
      <svg
        viewBox="0 0 48 48"
        aria-hidden="true"
      >
        <path
          d="M12 18h24v10H12zM16 28l-3 12m19-12 3 12M12 40h8m8 0h8M19 13h10"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `;
  }

  /*
   * Toolbar icons.
   * The visual UI uses icons only, while aria-label/title preserves
   * accessibility and makes the controls understandable on hover.
   */
  const icons = {
    gel: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19l9.8-9.8 3 3L8 22H5v-3Z"/>
        <path d="M13.5 5.5l2-2a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-2 2"/>
        <path d="M4 20l3-1"/>
      </svg>
    `,
    ballpoint: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 18.5 16.5 8l3.5 3.5L9.5 22H6v-3.5Z"/>
        <path d="m14 10 3 3"/>
        <path d="M18 4l2 2"/>
        <path d="M5 19 3 21"/>
      </svg>
    `,
    pencil: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 17 9.8-9.8 4.2 4.2L8.2 21H4v-4Z"/>
        <path d="m13.8 7.2 2-2 4.2 4.2-2 2"/>
        <path d="m4 17 4 4"/>
        <path d="M3 21h5"/>
      </svg>
    `,
    highlighter: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 15 8.8-8.8a1.7 1.7 0 0 1 2.4 0l1.6 1.6a1.7 1.7 0 0 1 0 2.4L9 19H5v-4Z"/>
        <path d="M5 19h12"/>
        <path d="M4 22h16"/>
      </svg>
    `,
    eraser: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 18-3-3a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 18H7Z"/>
        <path d="m12 18 4 4"/>
        <path d="M7 18h10"/>
      </svg>
    `,
    text: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h14"/>
        <path d="M12 5v14"/>
        <path d="M8 19h8"/>
      </svg>
    `,
    shapes: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="4" width="7" height="7" rx="1"/>
        <circle cx="17" cy="7.5" r="3.5"/>
        <path d="m6 20 5-6 5 6H6Z"/>
      </svg>
    `,
    image: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <circle cx="8.5" cy="9" r="1.5"/>
        <path d="m5 17 4-4 3 3 2-2 5 4"/>
      </svg>
    `,
    undo: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 7 4 12l5 5"/>
        <path d="M4 12h10a6 6 0 0 1 6 6"/>
      </svg>
    `,
    redo: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m15 7 5 5-5 5"/>
        <path d="M20 12H10a6 6 0 0 0-6 6"/>
      </svg>
    `,
    zoomOut: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <path d="M15.5 15.5 21 21"/>
        <path d="M8 10.5h5"/>
      </svg>
    `,
    zoomIn: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <path d="M15.5 15.5 21 21"/>
        <path d="M8 10.5h5M10.5 8v5"/>
      </svg>
    `,
  };

  function render() {
    const current = page();
    root.innerHTML = `
      <a
        class="subjects-spa-back"
        href="#/subjects/${subject.id}"
      >
        ← ${escape(subject.name)}
      </a>
      <section
        class="notebook-shell"
        style="--subject:${subject.color || "#f3a9c5"}"
      >
        <header class="notebook-head">
          <div class="notebook-title-icon">
            ${desk()}
          </div>
          <div>
            <p class="eyebrow">Caietul tău</p>
            <h2>${escape(subject.name)}</h2>
          </div>
          <small data-notebook-status>
            Pregătit
          </small>
        </header>

        <div
          class="notebook-toolbar"
          role="toolbar"
          aria-label="Instrumente caiet"
        >
          <button
            data-tool="gel"
            class="active"
            title="Pix gel"
            aria-label="Pix gel"
          >
            ${icons.gel}
          </button>

          <button
            data-tool="ballpoint"
            title="Pix"
            aria-label="Pix"
          >
            ${icons.ballpoint}
          </button>

          <button
            data-tool="pencil"
            title="Creion"
            aria-label="Creion"
          >
            ${icons.pencil}
          </button>

          <button
            data-tool="highlighter"
            title="Marker"
            aria-label="Marker"
          >
            ${icons.highlighter}
          </button>

          <button
            data-tool="eraser"
            title="Radieră"
            aria-label="Radieră"
          >
            ${icons.eraser}
          </button>

          <button
            data-tool="text"
            title="Text"
            aria-label="Text"
          >
            ${icons.text}
          </button>

          <button
            data-auto-shapes
            aria-pressed="${autoShapes}"
            title="Forme automate"
            aria-label="Forme automate"
          >
            ${icons.shapes}
          </button>

          <button
            data-add-image
            title="Adaugă imagine"
            aria-label="Adaugă imagine"
          >
            ${icons.image}
          </button>

          <button
            data-undo
            title="Anulează"
            aria-label="Anulează"
          >
            ${icons.undo}
          </button>

          <button
            data-redo
            title="Refă"
            aria-label="Refă"
          >
            ${icons.redo}
          </button>

          <button
            data-zoom-out
            title="Micșorează"
            aria-label="Micșorează"
          >
            ${icons.zoomOut}
          </button>

          <span
            class="notebook-zoom"
            data-zoom
            aria-label="Nivel zoom"
          >
            100%
          </span>

          <button
            data-zoom-in
            title="Mărește"
            aria-label="Mărește"
          >
            ${icons.zoomIn}
          </button>

          <input
            data-color
            type="color"
            value="${color}"
            aria-label="Culoare"
            title="Culoare"
          >

          <span
            class="notebook-swatches"
            aria-label="Paletă culori"
          >
            ${palette
              .map(
                (value) => `
                  <button
                    type="button"
                    data-swatch="${value}"
                    style="--swatch:${value};background:${value};"
                    aria-pressed="${
                      color.toLowerCase() === value.toLowerCase()
                    }"
                    aria-label="Culoare ${value}"
                    title="Culoare ${value}"
                  ></button>
                `
              )
              .join("")}
          </span>

          <input
            data-width
            type="range"
            min="1"
            max="12"
            value="${width}"
            aria-label="Grosime"
            title="Grosime"
          >
                    <select
            data-shape
            aria-label="Formă"
            title="Formă"
          >
            <option value="">Formă liberă</option>
            <option value="line">Linie</option>
            <option value="arrow">Săgeată</option>
            <option value="rectangle">Dreptunghi</option>
            <option value="ellipse">Elipsă</option>
            <option value="triangle">Triunghi</option>
          </select>

          <select
            data-template
            aria-label="Tip pagină"
            title="Tip pagină"
          >
            ${Object.entries(templates)
              .map(
                ([id, label]) => `
                  <option
                    value="${id}"
                    ${current.template === id ? "selected" : ""}
                  >
                    ${label}
                  </option>
                `
              )
              .join("")}
          </select>

          <select
            data-orientation
            aria-label="Orientare pagină"
            title="Orientare pagină"
          >
            <option
              value="portrait"
              ${current.orientation !== "landscape" ? "selected" : ""}
            >
              A4 portret
            </option>
            <option
              value="landscape"
              ${current.orientation === "landscape" ? "selected" : ""}
            >
              A4 peisaj
            </option>
          </select>

          <select
            data-background
            aria-label="Culoarea paginii"
            title="Culoarea paginii"
          >
            <option value="#fffdf9">Ivory</option>
            <option value="#ffffff">Alb</option>
            <option value="#f6f2ff">Lavandă</option>
            <option value="#eef7f5">Mentă</option>
            <option value="#fff4e8">Piersică</option>
          </select>

          <input
            data-image-input
            type="file"
            accept="image/*"
            hidden
          >
        </div>

        <p class="notebook-gesture-hint">
          Apple Pencil scrie; un deget deplasează pagina,
          două degete fac zoom.
        </p>

        <div class="notebook-paper-wrap">
          <canvas
            class="notebook-paper ${
              current.orientation === "landscape"
                ? "landscape"
                : ""
            }"
            aria-label="Caiet pentru scris cu Apple Pencil"
          ></canvas>
        </div>

        <footer class="notebook-footer">
          <button
            data-prev
            ${activePage === 0 ? "disabled" : ""}
          >
            ‹ Pagina anterioară
          </button>

          <span>
            Pagina ${activePage + 1} din ${notebook.pages.length}
          </span>

          <button
            data-next
            ${
              activePage === notebook.pages.length - 1
                ? "disabled"
                : ""
            }
          >
            Pagina următoare ›
          </button>

          <button
            class="primary-small-button"
            data-add-page
          >
            + Pagină
          </button>
        </footer>
      </section>
    `;

    canvas = root.querySelector("canvas");
    ctx = canvas.getContext("2d", {
      desynchronized: true,
    });

    resize();
    bind();
  }

  function resize() {
    if (!canvas) return;

    const ratio = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    canvas.width = Math.max(
      1,
      Math.round(w * ratio)
    );

    canvas.height = Math.max(
      1,
      Math.round(h * ratio)
    );

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    redraw();
  }

  function paintPaper() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle =
      page().background || "#fffdf9";

    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle =
      "rgba(142,169,207,.28)";

    ctx.lineWidth = 1;

    if (page().template === "lined") {
      for (let y = 42; y < h; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    if (page().template === "grid") {
      for (let x = 20; x < w; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      for (let y = 20; y < h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    ctx.strokeStyle =
      "rgba(224,109,136,.26)";

    ctx.beginPath();
    ctx.moveTo(44, 0);
    ctx.lineTo(44, h);
    ctx.stroke();
  }

  function drawStroke(stroke) {
    if (!stroke.points?.length) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const points = stroke.points;

    ctx.save();

    ctx.globalAlpha =
      stroke.tool === "highlighter"
        ? 0.24
        : stroke.tool === "pencil"
        ? 0.72
        : 1;

    ctx.strokeStyle = stroke.color;
    ctx.lineCap = ctx.lineJoin = "round";

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const next = points[i + 1];

      ctx.lineWidth =
        stroke.width *
        ((Number(a[2]) || 1) +
          (Number(b[2]) || 1)) /
        2;

      ctx.beginPath();

      ctx.moveTo(
        a[0] * w,
        a[1] * h
      );

      if (next) {
        ctx.quadraticCurveTo(
          b[0] * w,
          b[1] * h,
          ((b[0] + next[0]) * w) / 2,
          ((b[1] + next[1]) * h) / 2
        );
      } else {
        ctx.lineTo(
          b[0] * w,
          b[1] * h
        );
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  function drawElement(element) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (element.type === "text") {
      ctx.save();

      ctx.fillStyle =
        element.color || color;

      ctx.font = `${
        element.size || 21
      }px Manrope, sans-serif`;

      ctx.fillText(
        element.text,
        element.x * w,
        element.y * h
      );

      ctx.restore();
      return;
    }

    if (element.type === "shape") {
      ctx.save();

      ctx.strokeStyle =
        element.color;

      ctx.lineWidth =
        element.width;

      ctx.lineCap =
        ctx.lineJoin =
          "round";

      const x = element.x * w;
      const y = element.y * h;
      const sw = element.w * w;
      const sh = element.h * h;

      ctx.beginPath();

      if (element.shape === "line") {
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + sw,
          y + sh
        );
      } else if (
        element.shape === "arrow"
      ) {
        ctx.moveTo(x, y);

        ctx.lineTo(
          x + sw,
          y + sh
        );

        ctx.lineTo(
          x +
            sw -
            Math.sign(sw || 1) * 14,
          y +
            sh -
            Math.sign(sh || 1) * 7
        );

        ctx.moveTo(
          x + sw,
          y + sh
        );

        ctx.lineTo(
          x +
            sw -
            Math.sign(sw || 1) * 7,
          y +
            sh -
            Math.sign(sh || 1) * 14
        );
      } else if (
        element.shape === "triangle"
      ) {
        ctx.moveTo(
          x + sw / 2,
          y
        );

        ctx.lineTo(
          x + sw,
          y + sh
        );

        ctx.lineTo(
          x,
          y + sh
        );

        ctx.closePath();
      } else if (
        element.shape === "rectangle"
      ) {
        ctx.rect(
          x,
          y,
          sw,
          sh
        );
      } else {
        ctx.ellipse(
          x + sw / 2,
          y + sh / 2,
          Math.abs(sw / 2),
          Math.abs(sh / 2),
          0,
          0,
          Math.PI * 2
        );
      }

      ctx.stroke();
      ctx.restore();
      return;
    }

    if (element.type === "image") {
      let image = images.get(
        element.src
      );

      if (!image) {
        image = new Image();
        image.onload = queueRedraw;
        image.src = element.src;
        images.set(
          element.src,
          image
        );
      }

      if (image.complete) {
        ctx.drawImage(
          image,
          element.x * w,
          element.y * h,
          element.w * w,
          element.h * h
        );
      }
    }
  }

  function redraw() {
    if (!ctx || !canvas) return;

    paintPaper();

    page().strokes.forEach(drawStroke);
    page().elements.forEach(drawElement);
  }

  function queueRedraw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  }

  function clampPan(next = pan) {
    const maxX = Math.max(
      0,
      (canvas.clientWidth *
        (zoom - 1)) /
        2 +
        30
    );

    const maxY = Math.max(
      0,
      (canvas.clientHeight *
        (zoom - 1)) /
        2 +
        30
    );

    return {
      x: Math.max(
        -maxX,
        Math.min(maxX, next.x)
      ),
      y: Math.max(
        -maxY,
        Math.min(maxY, next.y)
      ),
    };
  }

  function setZoom(next) {
    zoom = Math.max(
      1,
      Math.min(3.2, next)
    );

    pan = clampPan();

    canvas.style.transform =
      `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;

    root.querySelector(
      "[data-zoom]"
    ).textContent =
      `${Math.round(zoom * 100)}%`;
  }

  function point(event) {
    const rect =
      canvas.getBoundingClientRect();

    const pressure =
      event.pointerType === "pen" &&
      Number.isFinite(event.pressure) &&
      event.pressure > 0
        ? Math.max(
            0.35,
            Math.min(
              1.8,
              event.pressure * 1.5
            )
          )
        : 1;

    return [
      Number(
        (
          (event.clientX -
            rect.left) /
          rect.width
        ).toFixed(4)
      ),
      Number(
        (
          (event.clientY -
            rect.top) /
          rect.height
        ).toFixed(4)
      ),
      pressure,
    ];
  }

  function begin(event) {
    cancelScheduledSave();

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    if (
      penPointerId !== null &&
      event.pointerType === "touch"
    ) {
      return;
    }

    event.preventDefault();

    canvas.setPointerCapture(
      event.pointerId
    );

    pointers.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      }
    );

    const writing =
      event.pointerType === "pen" ||
      event.pointerType === "mouse";

    if (event.pointerType === "pen") {
      penPointerId =
        event.pointerId;
    }

    if (
      pointers.size === 2 &&
      penPointerId === null
    ) {
      if (drawing) {
        page().strokes.pop();
      }

      drawing = null;

      const [a, b] =
        [...pointers.values()];

      canvas.dataset.gestureDistance =
        String(
          Math.hypot(
            a.x - b.x,
            a.y - b.y
          )
        );

      canvas.dataset.gestureZoom =
        String(zoom);

      canvas.dataset.gestureCenter =
        `${(a.x + b.x) / 2},${
          (a.y + b.y) / 2
        }`;

      canvas.dataset.gesturePan =
        `${pan.x},${pan.y}`;

      return;
    }

    canvas.dataset.gesturePan =
      `${pan.x},${pan.y}`;

    canvas.dataset.gestureCenter =
      `${event.clientX},${event.clientY}`;

    if (!writing) return;

    if (tool === "text") {
      return addText(event);
    }

    if (tool === "eraser") {
      return eraseAt(point(event));
    }

    redo = [];

    drawing = {       tool,
      color,
      width:
        tool === "highlighter"
          ? width * 3
          : width,
      points: [point(event)],
    };
    page().strokes.push(
      drawing
    );
    queueRedraw();
  }

  function move(event) {
    if (
      !pointers.has(event.pointerId)
    ) {
      return;
    }

    event.preventDefault();

    pointers.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      }
    );

    if (
      pointers.size >= 2 &&
      penPointerId === null
    ) {
      const [a, b] =
        [...pointers.values()];

      const distance =
        Math.hypot(
          a.x - b.x,
          a.y - b.y
        );

      const base = Number(
        canvas.dataset.gestureDistance ||
          distance
      );

      const [
        centerX,
        centerY,
      ] = String(
        canvas.dataset.gestureCenter ||
          "0,0"
      )
        .split(",")
        .map(Number);

      const [
        panX,
        panY,
      ] = String(
        canvas.dataset.gesturePan ||
          "0,0"
      )
        .split(",")
        .map(Number);

      pan = {
        x:
          panX +
          ((a.x + b.x) / 2 -
            centerX),
        y:
          panY +
          ((a.y + b.y) / 2 -
            centerY),
      };

      setZoom(
        Number(
          canvas.dataset.gestureZoom ||
            zoom
        ) *
          distance /
          base
      );

      return;
    }

    if (
      event.pointerType === "touch"
    ) {
      const [
        startX,
        startY,
      ] = String(
        canvas.dataset.gestureCenter ||
          "0,0"
      )
        .split(",")
        .map(Number);

      const [
        panX,
        panY,
      ] = String(
        canvas.dataset.gesturePan ||
          "0,0"
      )
        .split(",")
        .map(Number);

      pan = {
        x:
          panX +
          event.clientX -
          startX,
        y:
          panY +
          event.clientY -
          startY,
      };

      setZoom(zoom);
      return;
    }

    if (
      tool === "eraser"
    ) {
      return eraseAt(
        point(event)
      );
    }

    if (
      !drawing ||
      !canvas.hasPointerCapture(
        event.pointerId
      )
    ) {
      return;
    }

    const next = point(event);
    const last =
      drawing.points.at(-1);

    if (
      Math.abs(
        next[0] - last[0]
      ) +
        Math.abs(
          next[1] - last[1]
        ) <
        0.0015
    ) {
      return;
    }

    drawing.points.push(next);
    queueRedraw();
  }

  function recognizeShape(stroke) {
    const points =
      stroke.points || [];

    if (
      points.length < 2 ||
      points.length > 36
    ) {
      return null;
    }

    const xs =
      points.map((p) => p[0]);

    const ys =
      points.map((p) => p[1]);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const w = maxX - minX;
    const h = maxY - minY;

    if (
      Math.max(w, h) < 0.08
    ) {
      return null;
    }

    const first =
      points[0];

    const last =
      points.at(-1);

    const closed =
      Math.hypot(
        first[0] - last[0],
        first[1] - last[1]
      ) < 0.045;

    const closeTo =
      (x, y) =>
        points.some(
          (p) =>
            Math.hypot(
              p[0] - x,
              p[1] - y
            ) < 0.035
        );

    if (closed) {
      const rectangle =
        closeTo(minX, minY) &&
        closeTo(maxX, minY) &&
        closeTo(maxX, maxY) &&
        closeTo(minX, maxY);

      const triangle =
        closeTo(
          (minX + maxX) / 2,
          minY
        ) &&
        closeTo(minX, maxY) &&
        closeTo(maxX, maxY);

      return {
        type: "shape",
        shape: rectangle
          ? "rectangle"
          : triangle
          ? "triangle"
          : "ellipse",
        x: minX,
        y: minY,
        w,
        h,
        color: stroke.color,
        width: stroke.width,
      };
    }

    const tipIndex =
      points.reduce(
        (
          best,
          point,
          index
        ) =>
          Math.hypot(
            point[0] - first[0],
            point[1] - first[1]
          ) >
          Math.hypot(
            points[best][0] -
              first[0],
            points[best][1] -
              first[1]
          )
            ? index
            : best,
        0
      );

    const tip =
      points[tipIndex];

    if (
      points.length >= 6 &&
      tipIndex > 0 &&
      tipIndex <
        points.length - 2
    ) {
      return {
        type: "shape",
        shape: "arrow",
        x: first[0],
        y: first[1],
        w: tip[0] - first[0],
        h: tip[1] - first[1],
        color: stroke.color,
        width: stroke.width,
      };
    }

    const dx =
      last[0] - first[0];

    const dy =
      last[1] - first[1];

    const length =
      Math.hypot(dx, dy);

    const deviation =
      points.reduce(
        (sum, p) =>
          sum +
          Math.abs(
            dy * p[0] -
              dx * p[1] +
              last[0] * first[1] -
              last[1] * first[0]
          ) /
            length,
        0
      ) / points.length;

    if (
      deviation < 0.012
    ) {
      return {
        type: "shape",
        shape: "line",
        x: first[0],
        y: first[1],
        w: dx,
        h: dy,
        color: stroke.color,
        width: stroke.width,
      };
    }

    return null;
  }

  function makeShape(stroke, selectedShape) {
    const points = stroke.points || [];

    if (points.length < 2) {
      return null;
    }

    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      type: "shape",
      shape: selectedShape,
      x: minX,
      y: minY,
      w: Math.max(
        0.001,
        maxX - minX
      ),
      h: Math.max(
        0.001,
        maxY - minY
      ),
      color: stroke.color,
      width: stroke.width,
    };
  }

  /*
   * IMPORTANT:
   * pointerup never performs a synchronous full redraw.
   * The stroke is already in memory and the next frame handles
   * the visual update. Saving is also scheduled independently.
   */
  function finish(event) {
    pointers.delete(
      event.pointerId
    );

    if (
      event.pointerId ===
      penPointerId
    ) {
      penPointerId = null;
    }

    if (!drawing) return;

    if (
      drawing.points.length === 1
    ) {
      drawing.points.push([
        drawing.points[0][0] +
          0.001,
        drawing.points[0][1] +
          0.001,
        drawing.points[0][2] ||
          1,
      ]);
    }

    const shape = shapeTool
      ? makeShape(
          drawing,
          shapeTool
        )
      : autoShapes
      ? recognizeShape(drawing)
      : null;

    if (shape) {
      page().strokes.pop();

      page().elements.push(
        shape
      );
    }

    drawing = null;

    /*
     * Do NOT use redraw() here.
     * queueRedraw() schedules the work without making
     * pointerup wait for a complete canvas redraw.
     */
    queueRedraw();
    
  }

  function eraseAt(at) {
    const radius =
      Math.max(
        0.012,
        (width /
          Math.max(
            canvas.clientWidth,
            canvas.clientHeight
          )) *
          3
      );

    const removed =
      page().strokes.filter(
        (stroke) =>
          stroke.points.some(
            (p) =>
              Math.hypot(
                p[0] - at[0],
                p[1] - at[1]
              ) < radius
          )
      );

    if (!removed.length)
      return;

    page().strokes =
      page().strokes.filter(
        (stroke) =>
          !removed.includes(
            stroke
          )
      );

    redo.push(...removed);

    queueRedraw();
    saveSoon();
  }

  function addText(event) {
    const at = point(event);

    const input =
      document.createElement(
        "input"
      );

    input.className =
      "notebook-text-editor";

    input.placeholder =
      "Scrie aici";

    input.style.left =
      `${event.clientX}px`;

    input.style.top =
      `${event.clientY}px`;

    document.body.append(input);
    input.focus();

    const commit = () => {
      const text =
        input.value.trim();

      input.remove();

      if (text) {
        page().elements.push({
          type: "text",
          text,
          x: at[0],
          y: at[1],
          color,
          size: Math.max(
            16,
            width * 5
          ),
        });

        saveSoon();
        queueRedraw();
      }
    };

    input.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter")
          commit();

        if (e.key === "Escape")
          input.remove();
      }
    );

    input.addEventListener(
      "blur",
      commit,
      { once: true }
    );
  }

  async function addImage(file) {
    if (!file) return;

    updateStatus(
      "Pregătesc poza…"
    );

    const source =
      await fileToDataUrl(file);

    const image =
      await loadImage(source);

    const max = 1600;

    const ratio =
      Math.min(
        1,
        max /
          Math.max(
            image.width,
            image.height
          )
      );

    const off =
      document.createElement(
        "canvas"
      );

    off.width =
      Math.max(
        1,
        Math.round(
          image.width * ratio
        )
      );

    off.height =
      Math.max(
        1,
        Math.round(
          image.height * ratio
        )
      );

    off
      .getContext("2d")
      .drawImage(
        image,
        0,
        0,
        off.width,
        off.height
      );

    const src =
      off.toDataURL(
        "image/jpeg",
        0.8
      );

    const aspect =
      off.height / off.width;

    page().elements.push({
      type: "image",
      src,
      x: 0.12,
      y: 0.14,
      w: 0.76,
      h: Math.min(
        0.7,
        0.76 * aspect
      ),
    });

    saveSoon();
    queueRedraw();
  }

  function fileToDataUrl(file) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload =
          () => resolve(
            reader.result
          );

        reader.onerror =
          reject;

        reader.readAsDataURL(
          file
        );
      }
    );
  }
    function loadImage(src) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.onload = () =>
          resolve(image);

        image.onerror = reject;
        image.src = src;
      }
    );
  }

  function bind() {
    root
      .querySelectorAll(
        "[data-tool]"
      )
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => {
            tool =
              button.dataset.tool;

            root
              .querySelectorAll(
                "[data-tool]"
              )
              .forEach((item) =>
                item.classList.toggle(
                  "active",
                  item === button
                )
              );
          }
        )
      );

    root
      .querySelector(
        "[data-auto-shapes]"
      )
      .addEventListener(
        "click",
        (event) => {
          autoShapes =
            !autoShapes;

          if (autoShapes) {
            shapeTool = "";

            const shapeSelect =
              root.querySelector(
                "[data-shape]"
              );

            if (shapeSelect) {
              shapeSelect.value = "";
            }
          }

          event.currentTarget.classList.toggle(
            "active",
            autoShapes
          );

          event.currentTarget.setAttribute(
            "aria-pressed",
            String(autoShapes)
          );
        }
      );

    root
      .querySelector(
        "[data-shape]"
      )
      .addEventListener(
        "change",
        (event) => {
          shapeTool =
            event.target.value;

          if (shapeTool) {
            autoShapes = false;

            const autoButton =
              root.querySelector(
                "[data-auto-shapes]"
              );

            autoButton.classList.remove(
              "active"
            );

            autoButton.setAttribute(
              "aria-pressed",
              "false"
            );
          }
        }
      );

    root
      .querySelector(
        "[data-color]"
      )
      .addEventListener(
        "input",
        (e) => {
          color =
            e.target.value;

          root
            .querySelectorAll(
              "[data-swatch]"
            )
            .forEach((item) => {
              const selected =
                item.dataset.swatch.toLowerCase() ===
                color.toLowerCase();

              item.classList.toggle(
                "notebook-swatch-selected",
                selected
              );

              item.setAttribute(
                "aria-pressed",
                String(selected)
              );

              item.style.boxShadow =
                selected
                  ? "0 0 0 2px var(--surface), 0 0 0 4px currentColor"
                  : "";
            });
        }
      );

    root
      .querySelectorAll(
        "[data-swatch]"
      )
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => {
            color =
              button.dataset.swatch;

            root.querySelector(
              "[data-color]"
            ).value = color;

            root
              .querySelectorAll(
                "[data-swatch]"
              )
              .forEach((item) => {
                const selected =
                  item === button;

                item.classList.toggle(
                  "notebook-swatch-selected",
                  selected
                );

                item.setAttribute(
                  "aria-pressed",
                  String(selected)
                );

                item.style.boxShadow =
                  selected
                    ? "0 0 0 2px var(--surface), 0 0 0 4px currentColor"
                    : "";
              });
          }
        )
      );

    root
      .querySelector(
        "[data-width]"
      )
      .addEventListener(
        "input",
        (e) =>
          (width =
            Number(
              e.target.value
            ))
      );

    root
      .querySelector(
        "[data-template]"
      )
      .addEventListener(
        "change",
        (e) => {
          page().template =
            e.target.value;

          saveSoon();
          queueRedraw();
        }
      );

    root
      .querySelector(
        "[data-orientation]"
      )
      .addEventListener(
        "change",
        (e) => {
          page().orientation =
            e.target.value;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          saveSoon();
          render();
        }
      );

    root.querySelector(
      "[data-background]"
    ).value =
      page().background ||
      "#fffdf9";

    root
      .querySelector(
        "[data-background]"
      )
      .addEventListener(
        "change",
        (e) => {
          page().background =
            e.target.value;

          saveSoon();
          queueRedraw();
        }
      );

    root
      .querySelector(
        "[data-undo]"
      )
      .addEventListener(
        "click",
        () => {
          const item =
            page().strokes.pop() ||
            page().elements.pop();

          if (item) {
            redo.push(item);
            saveSoon();
            queueRedraw();
          }
        }
      );

    root
      .querySelector(
        "[data-redo]"
      )
      .addEventListener(
        "click",
        () => {
          const item =
            redo.pop();

          if (item) {
            (
              item.type
                ? page().elements
                : page().strokes
            ).push(item);

            saveSoon();
            queueRedraw();
          }
        }
      );

    root
      .querySelector(
        "[data-zoom-in]"
      )
      .addEventListener(
        "click",
        () =>
          setZoom(
            zoom + 0.2
          )
      );

    root
      .querySelector(
        "[data-zoom-out]"
      )
      .addEventListener(
        "click",
        () =>
          setZoom(
            zoom - 0.2
          )
      );

    root
      .querySelector(
        "[data-add-image]"
      )
      .addEventListener(
        "click",
        () =>
          root
            .querySelector(
              "[data-image-input]"
            )
            .click()
      );

    root
      .querySelector(
        "[data-image-input]"
      )
      .addEventListener(
        "change",
        (e) => {
          void addImage(
            e.target.files?.[0]
          );

          e.target.value = "";
        }
      );

    root
      .querySelector(
        "[data-prev]"
      )
      .addEventListener(
        "click",
        () => {
          activePage--;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          render();
        }
      );

    root
      .querySelector(
        "[data-next]"
      )
      .addEventListener(
        "click",
        () => {
          activePage++;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          render();
        }
      );

    root
      .querySelector(
        "[data-add-page]"
      )
      .addEventListener(
        "click",
        () => {
          notebook.pages.push({
            template:
              page().template,

            background:
              page().background ||
              "#fffdf9",

            orientation:
              page().orientation ||
              "portrait",

            strokes: [],
            elements: [],
          });

          activePage =
            notebook.pages.length -
            1;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          saveSoon();
          render();
        }
      );

    canvas.addEventListener(
      "pointerdown",
      begin,
      { passive: false }
    );

    canvas.addEventListener(
      "pointermove",
      move,
      { passive: false }
    );

    canvas.addEventListener(
      "pointerup",
      finish
    );

    canvas.addEventListener(
      "pointercancel",
      finish
    );

    global.addEventListener(
      "resize",
      resize,
      { once: true }
    );
  }

  function escape(value) {
    return String(value || "")
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      );
  }

  global.IteraNotebookView =
    Object.freeze({
      mount,
      unmount,
    });
})(window);