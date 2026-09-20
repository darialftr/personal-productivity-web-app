"use strict";

/*
 * ITERA NOTEBOOK
 *
 * Designed for low-latency Apple Pencil writing:
 * - coalesced pointer samples
 * - pointerrawupdate when available
 * - no aggressive point filtering
 * - no coordinate rounding
 * - static/offscreen page rendering
 * - live stroke rendering on top
 * - pressure-sensitive ink
 * - visual stroke stabilization without shape snapping
 * - debounced cloud persistence outside the writing path
 */

(function (global) {
  let root,
    canvas,
    ctx,
    backCanvas,
    backCtx,
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
    saveQuietTimer = 0,
    saveIdleHandle = 0,
    frame = 0,
    mounted = false,
    zoom = 1,
    pan = { x: 0, y: 0 },
    saveVersion = 0,
    autoShapes = false,
    shapeTool = "",
    saving = false,
    saveQueued = false,
    penPointerId = null,
    resizeObserver = null,
    rawPenSupported = false;

  const pointers = new Map();

  const images = new Map();

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

  const key = () =>
    `itera:notebook:${user?.id || "guest"}:${
      subject?.id || "subject"
    }`;

  function fresh() {
    return {
      version: 4,
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
    };
  }

  function page() {
    return notebook.pages[activePage];
  }

  /*
   * ---------------------------------------------------------
   * PERSISTENCE
   * ---------------------------------------------------------
   */

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(key()) || "null"
      );

      if (
        saved?.pages?.length &&
        Array.isArray(saved.pages)
      ) {
        return saved;
      }

      return fresh();
    } catch (_) {
      return fresh();
    }
  }

  async function loadCloud() {
    try {
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

        normalizeNotebook();

        render();
      }

      updateStatus("Sincronizat");
    } catch (_) {
      // Local notebook remains usable if cloud loading fails.
    }
  }

  function normalizeNotebook() {
    if (!notebook || !Array.isArray(notebook.pages)) {
      notebook = fresh();
    }

    notebook.pages.forEach((item) => {
      item.strokes ||= [];
      item.elements ||= [];
      item.background ||= "#fffdf9";
      item.orientation ||= "portrait";
      item.template ||= "lined";

      item.strokes.forEach((stroke) => {
        stroke.points ||= [];
        stroke.tool ||= "gel";
        stroke.color ||= "#4d4260";
        stroke.width ||= 3;
      });
    });
  }

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
        typeof global.cancelIdleCallback ===
        "function"
      ) {
        global.cancelIdleCallback(
          saveIdleHandle
        );
      } else {
        global.clearTimeout(
          saveIdleHandle
        );
      }

      saveIdleHandle = 0;
    }

    saveQueued = true;

    /*
     * Saving waits until the user has stopped interacting.
     * This timer NEVER runs inside a Pencil stroke.
     */
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
        typeof global.requestIdleCallback ===
        "function"
      ) {
        saveIdleHandle =
          global.requestIdleCallback(save, {
            timeout: 5000,
          });
      } else {
        saveIdleHandle = global.setTimeout(
          save,
          0
        );
      }
    }, 2000);
  }

  function saveSoon() {
    try {
      localStorage.setItem(
        key(),
        JSON.stringify(notebook)
      );
    } catch (_) {
      // Local storage may fail for very large notebooks.
    }

    scheduleNotebookSave();
  }

  async function persist() {
    if (!notebook || !user || !subject) {
      return;
    }

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
          typeof structuredClone ===
          "function"
            ? structuredClone(notebook)
            : JSON.parse(
                JSON.stringify(notebook)
              );
      } catch (_) {
        saving = false;
        updateStatus(
          "Eroare la pregătirea salvării"
        );
        return;
      }

      if (isUserInteracting()) {
        saveQueued = true;
        break;
      }

      let error = null;

      try {
        const result =
          await supabaseClient
            .from("notebooks")
            .upsert(
              {
                user_id: user.id,
                subject_id: subject.id,
                content: snapshot,
                updated_at:
                  new Date().toISOString(),
              },
              {
                onConflict:
                  "user_id,subject_id",
              }
            );

        error = result.error || null;
      } catch (_) {
        error = new Error(
          "Supabase save failed"
        );
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

    if (
      saveQueued &&
      mounted &&
      !isUserInteracting()
    ) {
      saveSoon();
    }
  }

  function updateStatus(text) {
    root
      ?.querySelector(
        "[data-notebook-status]"
      )
      ?.replaceChildren(text);
  }

  /*
   * ---------------------------------------------------------
   * MOUNT / UNMOUNT
   * ---------------------------------------------------------
   */

  async function mount(subjectId) {
    root =
      document.getElementById(
        "notebookViewRoot"
      );

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

    normalizeNotebook();

    activePage = 0;
    redo = [];
    zoom = 1;
    pan = {
      x: 0,
      y: 0,
    };

    render();

    void loadCloud();
  }

  function unmount() {
    cancelScheduledSave();

    if (notebook) {
      void persist();
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    mounted = false;

    root = null;
    canvas = null;
    ctx = null;
    backCanvas = null;
    backCtx = null;
    drawing = null;

    pointers.clear();
    penPointerId = null;
  }

  /*
   * ---------------------------------------------------------
   * ICONS
   * ---------------------------------------------------------
   */

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

  /*
   * ---------------------------------------------------------
   * RENDER UI
   * ---------------------------------------------------------
   */

  function render() {
    if (!root || !notebook || !subject) {
      return;
    }

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
            ${Math.round(zoom * 100)}%
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
                    style="
                      --swatch:${value};
                      background:${value};
                    "
                    aria-pressed="${
                      color.toLowerCase() ===
                      value.toLowerCase()
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
            step="0.5"
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
                    ${
                      current.template === id
                        ? "selected"
                        : ""
                    }
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
              ${
                current.orientation !==
                "landscape"
                  ? "selected"
                  : ""
              }
            >
              A4 portret
            </option>

            <option
              value="landscape"
              ${
                current.orientation ===
                "landscape"
                  ? "selected"
                  : ""
              }
            >
              A4 peisaj
            </option>
          </select>

          <select
            data-background
            aria-label="Culoarea paginii"
            title="Culoarea paginii"
          >
            <option value="#fffdf9">
              Ivory
            </option>

            <option value="#ffffff">
              Alb
            </option>

            <option value="#f6f2ff">
              Lavandă
            </option>

            <option value="#eef7f5">
              Mentă
            </option>

            <option value="#fff4e8">
              Piersică
            </option>
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

        <div
          class="notebook-paper-wrap"
          style="
            touch-action:none;
            overscroll-behavior:none;
          "
        >
          <canvas
            class="notebook-paper ${
              current.orientation ===
              "landscape"
                ? "landscape"
                : ""
            }"
            aria-label="Caiet pentru scris cu Apple Pencil"
            style="
              touch-action:none;
              user-select:none;
              -webkit-user-select:none;
              -webkit-touch-callout:none;
            "
          ></canvas>
        </div>

        <footer class="notebook-footer">
          <button
            data-prev
            ${
              activePage === 0
                ? "disabled"
                : ""
            }
          >
            ‹ Pagina anterioară
          </button>

          <span>
            Pagina ${activePage + 1}
            din ${notebook.pages.length}
          </span>

          <button
            data-next
            ${
              activePage ===
              notebook.pages.length - 1
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

    canvas =
      root.querySelector("canvas");

    ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });

    backCanvas =
      document.createElement("canvas");

    backCtx =
      backCanvas.getContext("2d", {
        alpha: true,
        desynchronized: true,
      });

    rawPenSupported =
      "onpointerrawupdate" in canvas;

    resize();

    bind();
  }

  /*
   * ---------------------------------------------------------
   * CANVAS SIZING
   * ---------------------------------------------------------
   */

  function resize() {
    if (!canvas || !backCanvas) {
      return;
    }

    const ratio = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    const w =
      canvas.clientWidth || 1;

    const h =
      canvas.clientHeight || 1;

    canvas.width = Math.max(
      1,
      Math.round(w * ratio)
    );

    canvas.height = Math.max(
      1,
      Math.round(h * ratio)
    );

    backCanvas.width =
      canvas.width;

    backCanvas.height =
      canvas.height;

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    backCtx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    redraw();
  }

  /*
   * ---------------------------------------------------------
   * PAPER
   * ---------------------------------------------------------
   */

  function paintPaper(target) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    target.clearRect(
      0,
      0,
      w,
      h
    );

    target.fillStyle =
      page().background ||
      "#fffdf9";

    target.fillRect(
      0,
      0,
      w,
      h
    );

    target.strokeStyle =
      "rgba(142,169,207,.28)";

    target.lineWidth = 1;

    if (
      page().template === "lined"
    ) {
      for (
        let y = 42;
        y < h;
        y += 28
      ) {
        target.beginPath();
        target.moveTo(0, y);
        target.lineTo(w, y);
        target.stroke();
      }
    }

    if (
      page().template === "grid"
    ) {
      for (
        let x = 20;
        x < w;
        x += 20
      ) {
        target.beginPath();
        target.moveTo(x, 0);
        target.lineTo(x, h);
        target.stroke();
      }

      for (
        let y = 20;
        y < h;
        y += 20
      ) {
        target.beginPath();
        target.moveTo(0, y);
        target.lineTo(w, y);
        target.stroke();
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * STROKE RENDERING
   * ---------------------------------------------------------
   *
   * The important change:
   *
   * The page is rendered once to backCanvas.
   * While the user writes, only the current stroke
   * is rendered on top.
   *
   * This prevents old notes/images/backgrounds from being
   * recalculated for every Pencil sample.
   */

  function strokeAlpha(stroke) {
    if (stroke.tool === "highlighter") {
      return 0.24;
    }

    if (stroke.tool === "pencil") {
      return 0.72;
    }

    return 1;
  }

  function pressureWidth(stroke, pressure) {
    const p =
      Number.isFinite(pressure)
        ? pressure
        : 0.5;

    const normalized =
      Math.max(
        0.12,
        Math.min(1.8, p)
      );

    let multiplier =
      0.48 +
      normalized * 0.72;

    if (
      stroke.tool ===
      "highlighter"
    ) {
      multiplier = 0.95;
    }

    return Math.max(
      0.4,
      stroke.width * multiplier
    );
  }

  function drawDot(
    target,
    stroke,
    point
  ) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    target.save();

    target.globalAlpha =
      strokeAlpha(stroke);

    target.fillStyle =
      stroke.color;

    const radius =
      Math.max(
        0.65,
        pressureWidth(
          stroke,
          point[2]
        ) / 2
      );

    target.beginPath();

    target.arc(
      point[0] * w,
      point[1] * h,
      radius,
      0,
      Math.PI * 2
    );

    target.fill();

    target.restore();
  }

  /*
   * Stabilized visual stroke.
   *
   * This does NOT change the stored points.
   * It only changes how they are drawn.
   *
   * Therefore handwriting is smoothed without letters
   * being interpreted as shapes.
   */
  function drawSmoothStroke(
    target,
    stroke
  ) {
    const points =
      stroke.points || [];

    if (!points.length) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    if (points.length === 1) {
      drawDot(
        target,
        stroke,
        points[0]
      );
      return;
    }

    target.save();

    target.globalAlpha =
      strokeAlpha(stroke);

    target.strokeStyle =
      stroke.color;

    target.lineCap = "round";
    target.lineJoin = "round";

    /*
     * A very short stroke should remain extremely responsive.
     * We do not wait for a long point history.
     */
    if (points.length === 2) {
      const a = points[0];
      const b = points[1];

      target.lineWidth =
        pressureWidth(
          stroke,
          (Number(a[2]) +
            Number(b[2])) /
            2
        );

      target.beginPath();

      target.moveTo(
        a[0] * w,
        a[1] * h
      );

      target.lineTo(
        b[0] * w,
        b[1] * h
      );

      target.stroke();

      target.restore();

      return;
    }

    /*
     * Quadratic midpoint smoothing.
     *
     * The curve passes through the user's path naturally
     * while removing the visible "polygon" look.
     */
    for (
      let i = 1;
      i < points.length - 1;
      i++
    ) {
      const a =
        points[i - 1];

      const b =
        points[i];

      const c =
        points[i + 1];

      const startX =
        ((a[0] + b[0]) / 2) *
        w;

      const startY =
        ((a[1] + b[1]) / 2) *
        h;

      const endX =
        ((b[0] + c[0]) / 2) *
        w;

      const endY =
        ((b[1] + c[1]) / 2) *
        h;

      const pressure =
        (Number(a[2]) +
          Number(b[2]) +
          Number(c[2])) /
        3;

      target.lineWidth =
        pressureWidth(
          stroke,
          pressure
        );

      target.beginPath();

      target.moveTo(
        startX,
        startY
      );

      target.quadraticCurveTo(
        b[0] * w,
        b[1] * h,
        endX,
        endY
      );

      target.stroke();
    }

    /*
     * Connect the beginning and end so short strokes
     * never lose their first/last pixels.
     */
    const first = points[0];
    const second = points[1];

    target.lineWidth =
      pressureWidth(
        stroke,
        (Number(first[2]) +
          Number(second[2])) /
          2
      );

    target.beginPath();

    target.moveTo(
      first[0] * w,
      first[1] * h
    );

    target.lineTo(
      ((first[0] +
        second[0]) /
        2) *
        w,
      ((first[1] +
        second[1]) /
        2) *
        h
    );

    target.stroke();

    const previous =
      points[points.length - 2];

    const last =
      points[points.length - 1];

    target.lineWidth =
      pressureWidth(
        stroke,
        (Number(previous[2]) +
          Number(last[2])) /
          2
      );

    target.beginPath();

    target.moveTo(
      ((previous[0] +
        last[0]) /
        2) *
        w,
      ((previous[1] +
        last[1]) /
        2) *
        h
    );

    target.lineTo(
      last[0] * w,
      last[1] * h
    );

    target.stroke();

    target.restore();
  }

  function drawElement(
    target,
    element
  ) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    target.save();

    if (
      element.type === "text"
    ) {
      target.fillStyle =
        element.color ||
        "#171717";

      target.font =
        `${element.size || 18}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

      target.textBaseline =
        "top";

      target.fillText(
        element.text || "",
        element.x * w,
        element.y * h
      );

      target.restore();

      return;
    }

    if (
      element.type === "image"
    ) {
      let image =
        images.get(element.src);

      if (!image) {
        image =
          new Image();

        image.onload = () => {
          images.set(
            element.src,
            image
          );

          redraw();
        };

        image.src =
          element.src;

        images.set(
          element.src,
          image
        );

        target.restore();

        return;
      }

      if (
        image.complete &&
        image.naturalWidth
      ) {
        target.drawImage(
          image,
          element.x * w,
          element.y * h,
          element.w * w,
          element.h * h
        );
      }

      target.restore();

      return;
    }

    if (
      element.type === "shape"
    ) {
      drawShape(
        target,
        element
      );
    }

    target.restore();
  }

  function drawShape(
    target,
    element
  ) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    const x =
      element.x * w;

    const y =
      element.y * h;

    const sw =
      element.w * w;

    const sh =
      element.h * h;

    target.strokeStyle =
      element.color ||
      "#171717";

    target.lineWidth =
      Math.max(
        1,
        element.width || 3
      );

    target.lineCap = "round";
    target.lineJoin = "round";

    target.beginPath();

    if (
      element.shape === "line"
    ) {
      target.moveTo(x, y);
      target.lineTo(
        x + sw,
        y + sh
      );
    }

    if (
      element.shape === "arrow"
    ) {
      drawArrow(
        target,
        x,
        y,
        x + sw,
        y + sh
      );
    }

    if (
      element.shape ===
      "rectangle"
    ) {
      target.rect(
        x,
        y,
        sw,
        sh
      );
    }

    if (
      element.shape ===
      "ellipse"
    ) {
      target.ellipse(
        x + sw / 2,
        y + sh / 2,
        Math.abs(sw / 2),
        Math.abs(sh / 2),
        0,
        0,
        Math.PI * 2
      );
    }

    if (
      element.shape ===
      "triangle"
    ) {
      target.moveTo(
        x + sw / 2,
        y
      );

      target.lineTo(
        x + sw,
        y + sh
      );

      target.lineTo(
        x,
        y + sh
      );

      target.closePath();
    }

    target.stroke();
  }

  function drawArrow(
    target,
    x1,
    y1,
    x2,
    y2
  ) {
    target.moveTo(
      x1,
      y1
    );

    target.lineTo(
      x2,
      y2
    );

    const angle =
      Math.atan2(
        y2 - y1,
        x2 - x1
      );

    const size = 10;

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        Math.cos(
          angle - Math.PI / 6
        ) *
          size,
      y2 -
        Math.sin(
          angle - Math.PI / 6
        ) *
          size
    );

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        Math.cos(
          angle + Math.PI / 6
        ) *
          size,
      y2 -
        Math.sin(
          angle + Math.PI / 6
        ) *
          size
    );
  }

  /*
   * ---------------------------------------------------------
   * STATIC + LIVE COMPOSITING
   * ---------------------------------------------------------
   */

  function redraw() {
    if (
      !canvas ||
      !ctx ||
      !backCanvas ||
      !backCtx ||
      !notebook
    ) {
      return;
    }

    paintPaper(backCtx);

    page().strokes.forEach(
      (stroke) => {
        drawSmoothStroke(
          backCtx,
          stroke
        );
      }
    );

    page().elements.forEach(
      (element) => {
        drawElement(
          backCtx,
          element
        );
      }
    );

    present();
  }

  function present() {
    if (
      !canvas ||
      !ctx ||
      !backCanvas
    ) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    ctx.clearRect(
      0,
      0,
      w,
      h
    );

    ctx.drawImage(
      backCanvas,
      0,
      0,
      w,
      h
    );

    if (drawing) {
      drawSmoothStroke(
        ctx,
        drawing
      );
    }
  }

  function queueRedraw() {
    if (frame) {
      return;
    }

    frame =
      global.requestAnimationFrame(
        () => {
          frame = 0;
          redraw();
        }
      );
  }

  /*
   * ---------------------------------------------------------
   * POINTER COORDINATES
   * ---------------------------------------------------------
   *
   * No toFixed().
   * No 0.0015 movement threshold.
   *
   * Small Pencil movements are important for handwriting.
   */

  function point(event) {
    const rect =
      canvas.getBoundingClientRect();

    const x =
      (event.clientX -
        rect.left) /
      rect.width;

    const y =
      (event.clientY -
        rect.top) /
      rect.height;

    let pressure = 0.5;

    if (
      event.pointerType === "pen" &&
      Number.isFinite(
        event.pressure
      )
    ) {
      pressure =
        event.pressure > 0
          ? event.pressure
          : 0.35;
    }

    return [
      Math.max(
        0,
        Math.min(1, x)
      ),
      Math.max(
        0,
        Math.min(1, y)
      ),
      pressure,
    ];
  }

  function distanceBetween(
    a,
    b
  ) {
    return Math.hypot(
      a[0] - b[0],
      a[1] - b[1]
    );
  }

  /*
   * ---------------------------------------------------------
   * POINTER DOWN
   * ---------------------------------------------------------
   */

  function begin(event) {
    cancelScheduledSave();

    if (
      event.pointerType ===
        "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    /*
     * When Pencil is active, touch is reserved for
     * navigation and pinch gestures.
     */
    if (
      penPointerId !== null &&
      event.pointerType === "touch"
    ) {
      return;
    }

    event.preventDefault();

    try {
      canvas.setPointerCapture(
        event.pointerId
      );
    } catch (_) {}

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

    if (
      event.pointerType === "pen"
    ) {
      penPointerId =
        event.pointerId;
    }

    /*
     * Two fingers = navigation.
     */
    if (
      pointers.size === 2 &&
      penPointerId === null
    ) {
      if (drawing) {
        page().strokes.pop();
      }

      drawing = null;

      const [
        a,
        b,
      ] = [...pointers.values()];

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

      present();

      return;
    }

    canvas.dataset.gesturePan =
      `${pan.x},${pan.y}`;

    canvas.dataset.gestureCenter =
      `${event.clientX},${event.clientY}`;

    if (!writing) {
      return;
    }

    if (
      tool === "text"
    ) {
      return addText(event);
    }

    if (
      tool === "eraser"
    ) {
      return eraseAt(
        point(event)
      );
    }

    redo = [];

    drawing = {
      tool,
      color,
      width:
        tool === "highlighter"
          ? width * 3
          : width,
      points: [
        point(event),
      ],
    };

    page().strokes.push(
      drawing
    );

    /*
     * Immediately show the first Pencil contact.
     * This is important for dots and tiny marks.
     */
    present();
  }

  /*
   * ---------------------------------------------------------
   * POINTER MOVE
   * ---------------------------------------------------------
   */

  function processPenSample(
    event
  ) {
    if (!drawing) {
      return;
    }

    if (
      !canvas.hasPointerCapture(
        event.pointerId
      )
    ) {
      return;
    }

    const next =
      point(event);

    const last =
      drawing.points[
        drawing.points.length - 1
      ];

    /*
     * Only reject genuinely identical samples.
     * Do NOT use a large distance threshold.
     */
    if (
      next[0] === last[0] &&
      next[1] === last[1] &&
      next[2] === last[2]
    ) {
      return;
    }

    drawing.points.push(
      next
    );
  }

  function move(event) {
    if (
      !pointers.has(
        event.pointerId
      )
    ) {
      return;
    }

    /*
     * Pen gets raw/coalesced processing.
     * pointermove is skipped when raw events are available
     * so we don't draw the same samples twice.
     */
    if (
      event.pointerType === "pen" &&
      rawPenSupported
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

    /*
     * Two-finger gesture.
     */
    if (
      pointers.size >= 2 &&
      penPointerId === null
    ) {
      const [
        a,
        b,
      ] = [...pointers.values()];

      const distance =
        Math.hypot(
          a.x - b.x,
          a.y - b.y
        );

      const base =
        Number(
          canvas.dataset
            .gestureDistance ||
            distance
        );

      const [
        centerX,
        centerY,
      ] = String(
        canvas.dataset
          .gestureCenter ||
          "0,0"
      )
        .split(",")
        .map(Number);

      const [
        panX,
        panY,
      ] = String(
        canvas.dataset
          .gesturePan ||
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
          canvas.dataset
            .gestureZoom ||
            zoom
        ) *
          distance /
          Math.max(1, base)
      );

      return;
    }

    /*
     * One finger pans the page.
     */
    if (
      event.pointerType === "touch"
    ) {
      const [
        startX,
        startY,
      ] = String(
        canvas.dataset
          .gestureCenter ||
          "0,0"
      )
        .split(",")
        .map(Number);

      const [
        panX,
        panY,
      ] = String(
        canvas.dataset
          .gesturePan ||
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

    /*
     * Capture every coalesced sample.
     *
     * This is one of the biggest improvements for Apple Pencil.
     */
    const samples =
      typeof event.getCoalescedEvents ===
      "function"
        ? event.getCoalescedEvents()
        : [event];

    for (
      const sample of samples
    ) {
      processPenSample(sample);
    }

    /*
     * Render only the current stroke.
     * The page itself is NOT recalculated.
     */
    present();
  }

  /*
   * ---------------------------------------------------------
   * RAW PENCIL INPUT
   * ---------------------------------------------------------
   */

  function rawPenMove(event) {
    if (
      event.pointerType !== "pen"
    ) {
      return;
    }

    if (
      !drawing ||
      event.pointerId !==
        penPointerId
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

    /*
     * rawupdate may contain extremely small movements.
     * Capture them all.
     */
    processPenSample(event);

    present();
  }

  /*
   * ---------------------------------------------------------
   * POINTER UP
   * ---------------------------------------------------------
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

    if (!drawing) {
      return;
    }

    /*
     * Make sure the final pointer position is captured.
     */
    if (
      event.pointerType ===
      "pen"
    ) {
      const finalPoint =
        point(event);

      const last =
        drawing.points[
          drawing.points.length - 1
        ];

      if (
        !last ||
        distanceBetween(
          finalPoint,
          last
        ) > 0
      ) {
        drawing.points.push(
          finalPoint
        );
      }
    }

    /*
     * A one-point stroke is a dot.
     * We keep it as a real dot instead of inventing
     * a diagonal line.
     */
    if (
      drawing.points.length === 1
    ) {
      const p =
        drawing.points[0];

      drawing.points.push([
        p[0],
        p[1],
        p[2] || 0.5,
      ]);
    }

    const shape =
      shapeTool
        ? makeShape(
            drawing,
            shapeTool
          )
        : autoShapes
        ? recognizeShape(
            drawing
          )
        : null;

    if (shape) {
      page().strokes.pop();

      page().elements.push(
        shape
      );
    }

    drawing = null;

    /*
     * Redraw the static page only AFTER the stroke is finished.
     * pointerup itself stays extremely cheap.
     */
    queueRedraw();

    /*
     * Saving is completely separate from pointer handling.
     */
    saveSoon();
  }

  /*
   * ---------------------------------------------------------
   * SHAPES
   * ---------------------------------------------------------
   */

  function recognizeShape(
    stroke
  ) {
    const points =
      stroke.points || [];

    if (
      points.length < 2 ||
      points.length > 36
    ) {
      return null;
    }

    const xs =
      points.map(
        (p) => p[0]
      );

    const ys =
      points.map(
        (p) => p[1]
      );

    const minX =
      Math.min(...xs);

    const maxX =
      Math.max(...xs);

    const minY =
      Math.min(...ys);

    const maxY =
      Math.max(...ys);

    const w =
      maxX - minX;

    const h =
      maxY - minY;

    /*
     * Important:
     * Tiny handwriting is NEVER auto-converted into shapes.
     */
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
        closeTo(
          minX,
          minY
        ) &&
        closeTo(
          maxX,
          minY
        ) &&
        closeTo(
          maxX,
          maxY
        ) &&
        closeTo(
          minX,
          maxY
        );

      const triangle =
        closeTo(
          (minX + maxX) / 2,
          minY
        ) &&
        closeTo(
          minX,
          maxY
        ) &&
        closeTo(
          maxX,
          maxY
        );

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

        color:
          stroke.color,

        width:
          stroke.width,
      };
    }

    const tipIndex =
      points.reduce(
        (
          best,
          current,
          index
        ) =>
          Math.hypot(
            current[0] -
              first[0],
            current[1] -
              first[1]
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
        w:
          tip[0] -
          first[0],
        h:
          tip[1] -
          first[1],
        color:
          stroke.color,
        width:
          stroke.width,
      };
    }

    const dx =
      last[0] -
      first[0];

    const dy =
      last[1] -
      first[1];

    const length =
      Math.hypot(
        dx,
        dy
      );

    if (length === 0) {
      return null;
    }

    const deviation =
      points.reduce(
        (sum, p) =>
          sum +
          Math.abs(
            dy * p[0] -
              dx * p[1] +
              last[0] *
                first[1] -
              last[1] *
                first[0]
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
        color:
          stroke.color,
        width:
          stroke.width,
      };
    }

    return null;
  }

  function makeShape(
    stroke,
    selectedShape
  ) {
    const points =
      stroke.points || [];

    if (
      points.length < 2
    ) {
      return null;
    }

    const xs =
      points.map(
        (p) => p[0]
      );

    const ys =
      points.map(
        (p) => p[1]
      );

    const minX =
      Math.min(...xs);

    const maxX =
      Math.max(...xs);

    const minY =
      Math.min(...ys);

    const maxY =
      Math.max(...ys);

    return {
      type: "shape",

      shape:
        selectedShape,

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

      color:
        stroke.color,

      width:
        stroke.width,
    };
  }

  /*
   * ---------------------------------------------------------
   * ERASER
   * ---------------------------------------------------------
   */

  function eraseAt(at) {
    if (!canvas) {
      return;
    }

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

    if (
      !removed.length
    ) {
      return;
    }

    page().strokes =
      page().strokes.filter(
        (stroke) =>
          !removed.includes(
            stroke
          )
      );

    redo.push(
      ...removed
    );

    queueRedraw();
    saveSoon();
  }

  /*
   * ---------------------------------------------------------
   * TEXT
   * ---------------------------------------------------------
   */

  function addText(event) {
    const at =
      point(event);

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

    document.body.append(
      input
    );

    input.focus();

    let committed = false;

    const commit = () => {
      if (committed) {
        return;
      }

      committed = true;

      const text =
        input.value.trim();

      input.remove();

      if (!text) {
        return;
      }

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
    };

    input.addEventListener(
      "keydown",
      (e) => {
        if (
          e.key === "Enter"
        ) {
          commit();
        }

        if (
          e.key === "Escape"
        ) {
          committed = true;
          input.remove();
        }
      }
    );

    input.addEventListener(
      "blur",
      commit,
      { once: true }
    );
  }

  /*
   * ---------------------------------------------------------
   * IMAGES
   * ---------------------------------------------------------
   */

  async function addImage(
    file
  ) {
    if (!file) {
      return;
    }

    updateStatus(
      "Pregătesc poza…"
    );

    try {
      const source =
        await fileToDataUrl(
          file
        );

      const image =
        await loadImage(
          source
        );

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
            image.width *
              ratio
          )
        );

      off.height =
        Math.max(
          1,
          Math.round(
            image.height *
              ratio
          )
        );

      const offCtx =
        off.getContext("2d");

      offCtx.drawImage(
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
        off.height /
        off.width;

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

      updateStatus(
        "Imagine adăugată"
      );
    } catch (_) {
      updateStatus(
        "Nu am putut adăuga imaginea"
      );
    }
  }

  function fileToDataUrl(
    file
  ) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () =>
          resolve(
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

  function loadImage(
    src
  ) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        image.onload = () =>
          resolve(image);

        image.onerror =
          reject;

        image.src = src;
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * ZOOM / PAN
   * ---------------------------------------------------------
   */

  function setZoom(value) {
    zoom = Math.max(
      0.5,
      Math.min(3, value)
    );

    if (!canvas) {
      return;
    }

    canvas.style.transform =
      `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

    const zoomLabel =
      root?.querySelector(
        "[data-zoom]"
      );

    if (zoomLabel) {
      zoomLabel.textContent =
        `${Math.round(
          zoom * 100
        )}%`;
    }
  }

  /*
   * ---------------------------------------------------------
   * UI BINDINGS
   * ---------------------------------------------------------
   */

  function bind() {
    root
      .querySelectorAll(
        "[data-tool]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            tool =
              button.dataset.tool;

            root
              .querySelectorAll(
                "[data-tool]"
              )
              .forEach(
                (item) => {
                  item.classList.toggle(
                    "active",
                    item === button
                  );
                }
              );
          }
        );
      });

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

            const select =
              root.querySelector(
                "[data-shape]"
              );

            if (select) {
              select.value = "";
            }
          }

          event.currentTarget.classList.toggle(
            "active",
            autoShapes
          );

          event.currentTarget.setAttribute(
            "aria-pressed",
            String(
              autoShapes
            )
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

            const button =
              root.querySelector(
                "[data-auto-shapes]"
              );

            button.classList.remove(
              "active"
            );

            button.setAttribute(
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
        (event) => {
          color =
            event.target.value;

          updateSwatches();
        }
      );

    root
      .querySelectorAll(
        "[data-swatch]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            color =
              button.dataset.swatch;

            const picker =
              root.querySelector(
                "[data-color]"
              );

            if (picker) {
              picker.value =
                color;
            }

            updateSwatches();
          }
        );
      });

    root
      .querySelector(
        "[data-width]"
      )
      .addEventListener(
        "input",
        (event) => {
          width =
            Number(
              event.target.value
            );
        }
      );

    root
      .querySelector(
        "[data-template]"
      )
      .addEventListener(
        "change",
        (event) => {
          page().template =
            event.target.value;

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
        (event) => {
          page().orientation =
            event.target.value;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          saveSoon();

          render();
        }
      );

    const background =
      root.querySelector(
        "[data-background]"
      );

    background.value =
      page().background ||
      "#fffdf9";

    background.addEventListener(
      "change",
      (event) => {
        page().background =
          event.target.value;

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

          if (!item) {
            return;
          }

          redo.push(item);

          saveSoon();
          queueRedraw();
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

          if (!item) {
            return;
          }

          (
            item.type
              ? page().elements
              : page().strokes
          ).push(item);

          saveSoon();
          queueRedraw();
        }
      );

    root
      .querySelector(
        "[data-zoom-in]"
      )
      .addEventListener(
        "click",
        () => {
          setZoom(
            zoom + 0.2
          );
        }
      );

    root
      .querySelector(
        "[data-zoom-out]"
      )
      .addEventListener(
        "click",
        () => {
          setZoom(
            zoom - 0.2
          );
        }
      );

    root
      .querySelector(
        "[data-add-image]"
      )
      .addEventListener(
        "click",
        () => {
          root
            .querySelector(
              "[data-image-input]"
            )
            .click();
        }
      );

    root
      .querySelector(
        "[data-image-input]"
      )
      .addEventListener(
        "change",
        (event) => {
          void addImage(
            event.target.files?.[0]
          );

          event.target.value =
            "";
        }
      );

    root
      .querySelector(
        "[data-prev]"
      )
      .addEventListener(
        "click",
        () => {
          if (
            activePage <= 0
          ) {
            return;
          }

          activePage--;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          redo = [];

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
          if (
            activePage >=
            notebook.pages.length - 1
          ) {
            return;
          }

          activePage++;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          redo = [];

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

          redo = [];

          saveSoon();

          render();
        }
      );

    /*
     * Pointer input.
     */
    canvas.addEventListener(
      "pointerdown",
      begin,
      {
        passive: false,
      }
    );

    canvas.addEventListener(
      "pointermove",
      move,
      {
        passive: false,
      }
    );

    canvas.addEventListener(
      "pointerup",
      finish
    );

    canvas.addEventListener(
      "pointercancel",
      finish
    );

    /*
     * Extra raw Pencil path.
     */
    if (
      rawPenSupported
    ) {
      canvas.addEventListener(
        "pointerrawupdate",
        rawPenMove,
        {
          passive: false,
        }
      );
    }

    /*
     * Prevent context menus / long press interference.
     */
    canvas.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
      }
    );

    /*
     * Resize observer instead of a one-time resize listener.
     */
    if (
      typeof ResizeObserver !==
      "undefined"
    ) {
      resizeObserver =
        new ResizeObserver(
          () => {
            resize();
          }
        );

      resizeObserver.observe(
        canvas
      );
    }

    updateSwatches();

    setZoom(zoom);
  }

  function updateSwatches() {
    root
      ?.querySelectorAll(
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

  /*
   * ---------------------------------------------------------
   * ESCAPE
   * ---------------------------------------------------------
   */

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

  /*
   * ---------------------------------------------------------
   * PUBLIC API
   * ---------------------------------------------------------
   */

  global.IteraNotebookView =
    Object.freeze({
      mount,
      unmount,
    });
})(window);