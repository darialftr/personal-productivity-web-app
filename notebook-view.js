"use strict";

/*
 * ITERA NOTEBOOK
 *
 * Focus:
 * - Apple Pencil / stylus low latency
 * - live ink layer
 * - static page layer
 * - coalesced pointer samples
 * - no coordinate rounding
 * - no movement threshold that kills tiny strokes
 * - immediate dots / tiny strokes
 * - light handwriting stabilization
 * - pressure-sensitive ink
 * - fullscreen Focus Mode
 * - Apple-like bubbly floating toolbar
 * - Supabase persistence outside the writing path
 */

(function (global) {
  let root = null;
  let canvas = null;
  let ctx = null;
  let inkCanvas = null;
  let inkCtx = null;

  let subject = null;
  let user = null;
  let notebook = null;

  let activePage = 0;

  let tool = "gel";
  let color = "#4d4260";
  let width = 3;

  let drawing = null;
  let redo = [];

  let mounted = false;
  let zoom = 1;
  let pan = { x: 0, y: 0 };

  let saveTimer = 0;
  let saving = false;
  let saveQueued = false;
  let saveVersion = 0;

  let resizeObserver = null;

  let fullscreen = false;
  let toolbarHideTimer = 0;

  let autoShapes = false;
  let shapeTool = "";

  const pointers = new Map();

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

  const templates = {
    lined: "Liniat",
    grid: "Pătrățele",
    blank: "Simplu",
  };

  const styles = `
    .notebook-shell {
      --nb-accent: #f3a9c5;
      position: relative;
      width: 100%;
      min-height: calc(100vh - 120px);
      padding: 18px;
      box-sizing: border-box;
    }

    .notebook-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .notebook-title-icon {
      width: 42px;
      height: 42px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: color-mix(
        in srgb,
        var(--nb-accent) 24%,
        transparent
      );
      color: var(--nb-accent);
    }

    .notebook-title-icon svg {
      width: 25px;
      height: 25px;
    }

    .notebook-head h2 {
      margin: 1px 0 0;
    }

    .notebook-head .eyebrow {
      margin: 0;
      font-size: 11px;
      opacity: .55;
    }

    .notebook-head small {
      margin-left: auto;
      opacity: .55;
      font-size: 11px;
    }

    .notebook-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
      padding: 9px;
      border-radius: 22px;
      margin-bottom: 14px;
      background: color-mix(
        in srgb,
        var(--surface, #fff) 90%,
        var(--nb-accent) 10%
      );
      border: 1px solid color-mix(
        in srgb,
        var(--nb-accent) 18%,
        transparent
      );
      box-shadow:
        0 8px 28px rgba(0,0,0,.07),
        inset 0 1px 0 rgba(255,255,255,.7);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
    }

    .notebook-toolbar button {
      width: 38px;
      height: 38px;
      border: 0;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: transparent;
      color: currentColor;
      cursor: pointer;
      transition:
        transform .12s ease,
        background .12s ease,
        color .12s ease;
      flex: 0 0 auto;
    }

    .notebook-toolbar button:hover {
      background: rgba(127,127,127,.11);
      transform: scale(1.04);
    }

    .notebook-toolbar button:active {
      transform: scale(.94);
    }

    .notebook-toolbar button.active {
      background: var(--nb-accent);
      color: white;
      box-shadow:
        0 4px 13px color-mix(
          in srgb,
          var(--nb-accent) 35%,
          transparent
        );
    }

    .notebook-toolbar svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .notebook-toolbar input[type="range"] {
      width: 74px;
      accent-color: var(--nb-accent);
    }

    .notebook-toolbar input[type="color"] {
      width: 28px;
      height: 28px;
      border: 0;
      padding: 0;
      border-radius: 50%;
      overflow: hidden;
      cursor: pointer;
      background: transparent;
    }

    .notebook-toolbar select {
      height: 34px;
      border: 0;
      border-radius: 12px;
      padding: 0 9px;
      background: rgba(127,127,127,.09);
      color: inherit;
      font-size: 12px;
    }

    .notebook-zoom {
      min-width: 44px;
      text-align: center;
      font-size: 11px;
      opacity: .65;
    }

    .notebook-swatches {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 4px;
    }

    .notebook-toolbar .notebook-swatches button {
      width: 20px;
      height: 20px;
      min-width: 20px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.72);
      padding: 0;
      box-sizing: border-box;
    }

    .notebook-toolbar .notebook-swatches button.notebook-swatch-selected {
      transform: scale(1.18);
      outline: 2px solid var(--nb-accent);
      outline-offset: 2px;
    }

    .notebook-stage {
      position: relative;
      width: 100%;
      height: min(76vh, 920px);
      min-height: 500px;
      overflow: hidden;
      border-radius: 24px;
      background: rgba(127,127,127,.07);
      touch-action: none;
      overscroll-behavior: none;
      user-select: none;
      -webkit-user-select: none;
    }

    .notebook-sheet {
      position: absolute;
      left: 50%;
      top: 50%;
      transform-origin: center center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      box-shadow:
        0 12px 45px rgba(0,0,0,.12),
        0 2px 7px rgba(0,0,0,.06);
      border-radius: 3px;
      overflow: hidden;
    }

    .notebook-sheet canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }

    .notebook-base-canvas {
      pointer-events: none;
    }

    .notebook-ink-canvas {
      pointer-events: auto;
    }

    .notebook-page-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      margin-top: 10px;
    }

    .notebook-page-controls button {
      border: 0;
      min-width: 38px;
      height: 34px;
      border-radius: 12px;
      background: rgba(127,127,127,.09);
      color: inherit;
      cursor: pointer;
    }

    .notebook-page-controls button:hover {
      background: rgba(127,127,127,.15);
    }

    .notebook-page-controls span {
      font-size: 11px;
      opacity: .58;
    }

    .notebook-fullscreen-button {
      margin-left: auto;
    }

    /* -----------------------------------------------------
       FOCUS MODE
       ----------------------------------------------------- */

    .notebook-focus {
      position: fixed !important;
      inset: 0 !important;
      z-index: 999999 !important;
      width: 100vw !important;
      height: 100dvh !important;
      min-height: 100dvh !important;
      padding:
        max(10px, env(safe-area-inset-top))
        max(10px, env(safe-area-inset-right))
        max(10px, env(safe-area-inset-bottom))
        max(10px, env(safe-area-inset-left)) !important;
      box-sizing: border-box;
      background: var(--background, #f7f5f8);
    }

    .notebook-focus .notebook-head {
      display: none;
    }

    .notebook-focus .subjects-spa-back {
      display: none;
    }

    .notebook-focus .notebook-toolbar {
      position: fixed;
      z-index: 1000001;
      top: max(12px, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%);
      width: max-content;
      max-width: calc(100vw - 24px);
      margin: 0;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      border-radius: 24px;
      padding: 7px;
      background: rgba(255,255,255,.72);
      color: #171717;
      box-shadow:
        0 10px 36px rgba(0,0,0,.12),
        inset 0 1px 0 rgba(255,255,255,.9);
      transition:
        opacity .18s ease,
        transform .18s ease;
    }

    .notebook-focus .notebook-toolbar::-webkit-scrollbar {
      display: none;
    }

    .notebook-focus .notebook-toolbar.hidden {
      opacity: 0;
      pointer-events: none;
      transform:
        translateX(-50%)
        translateY(-12px)
        scale(.97);
    }

    .notebook-focus .notebook-stage {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100dvh;
      min-height: 0;
      border-radius: 0;
      background: var(--background, #f7f5f8);
    }

    .notebook-focus .notebook-page-controls {
      position: fixed;
      z-index: 1000000;
      bottom: max(14px, env(safe-area-inset-bottom));
      left: 50%;
      transform: translateX(-50%);
      margin: 0;
      padding: 6px 8px;
      border-radius: 18px;
      background: rgba(255,255,255,.68);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      box-shadow: 0 8px 25px rgba(0,0,0,.1);
    }

    .notebook-focus .notebook-fullscreen-button {
      display: grid;
    }

    .notebook-focus .notebook-fullscreen-button {
      position: fixed;
      z-index: 1000002;
      top: max(12px, env(safe-area-inset-top));
      right: max(12px, env(safe-area-inset-right));
      width: 38px;
      height: 38px;
      border-radius: 14px;
      background: rgba(255,255,255,.78);
      box-shadow: 0 5px 18px rgba(0,0,0,.1);
    }

    .notebook-text-editor {
      position: fixed;
      z-index: 1000010;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 12px;
      padding: 9px 11px;
      outline: none;
      background: rgba(255,255,255,.96);
      box-shadow: 0 8px 28px rgba(0,0,0,.14);
      color: #171717;
      font: 16px system-ui, sans-serif;
    }

    @media (max-width: 800px) {
      .notebook-shell {
        padding: 10px;
      }

      .notebook-toolbar {
        gap: 4px;
        padding: 7px;
      }

      .notebook-toolbar button {
        width: 35px;
        height: 35px;
        border-radius: 12px;
      }

      .notebook-toolbar select,
      .notebook-toolbar input[type="range"] {
        display: none;
      }

      .notebook-stage {
        height: calc(100dvh - 210px);
        min-height: 400px;
      }
    }
  `;

  const icons = {
    gel: `
      <svg viewBox="0 0 24 24">
        <path d="M5 19l9.8-9.8 3 3L8 22H5v-3Z"/>
        <path d="M13.5 5.5l2-2a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-2 2"/>
      </svg>
    `,

    ballpoint: `
      <svg viewBox="0 0 24 24">
        <path d="M6 18.5 16.5 8l3.5 3.5L9.5 22H6v-3.5Z"/>
        <path d="m14 10 3 3"/>
        <path d="M18 4l2 2"/>
      </svg>
    `,

    pencil: `
      <svg viewBox="0 0 24 24">
        <path d="m4 17 9.8-9.8 4.2 4.2L8.2 21H4v-4Z"/>
        <path d="m13.8 7.2 2-2 4.2 4.2-2 2"/>
        <path d="m4 17 4 4"/>
      </svg>
    `,

    highlighter: `
      <svg viewBox="0 0 24 24">
        <path d="m5 15 8.8-8.8a1.7 1.7 0 0 1 2.4 0l1.6 1.6a1.7 1.7 0 0 1 0 2.4L9 19H5v-4Z"/>
        <path d="M5 19h12"/>
        <path d="M4 22h16"/>
      </svg>
    `,

    eraser: `
      <svg viewBox="0 0 24 24">
        <path d="m7 18-3-3a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 18H7Z"/>
        <path d="M7 18h10"/>
      </svg>
    `,

    text: `
      <svg viewBox="0 0 24 24">
        <path d="M5 5h14"/>
        <path d="M12 5v14"/>
        <path d="M8 19h8"/>
      </svg>
    `,

    shapes: `
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="4" width="7" height="7" rx="1"/>
        <circle cx="17" cy="7.5" r="3.5"/>
        <path d="m6 20 5-6 5 6H6Z"/>
      </svg>
    `,

    image: `
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <circle cx="8.5" cy="9" r="1.5"/>
        <path d="m5 17 4-4 3 3 2-2 5 4"/>
      </svg>
    `,

    undo: `
      <svg viewBox="0 0 24 24">
        <path d="M9 7 4 12l5 5"/>
        <path d="M4 12h10a6 6 0 0 1 6 6"/>
      </svg>
    `,

    redo: `
      <svg viewBox="0 0 24 24">
        <path d="m15 7 5 5-5 5"/>
        <path d="M20 12H10a6 6 0 0 0-6 6"/>
      </svg>
    `,

    zoomOut: `
      <svg viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <path d="M15.5 15.5 21 21"/>
        <path d="M8 10.5h5"/>
      </svg>
    `,

    zoomIn: `
      <svg viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5"/>
        <path d="M15.5 15.5 21 21"/>
        <path d="M8 10.5h5M10.5 8v5"/>
      </svg>
    `,

    fullscreen: `
      <svg viewBox="0 0 24 24">
        <path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"/>
      </svg>
    `,

    exitFullscreen: `
      <svg viewBox="0 0 24 24">
        <path d="M9 4v5H4M15 4v5h5M4 15h5v5M20 15h-5v5"/>
      </svg>
    `,
  };

  function injectStyles() {
    if (document.getElementById("itera-notebook-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "itera-notebook-styles";
    style.textContent = styles;
    document.head.appendChild(style);
  }

  function freshNotebook() {
    return {
      version: 5,
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

  function currentPage() {
    return notebook.pages[activePage];
  }

  function storageKey() {
    return `itera:notebook:${user?.id || "guest"}:${
      subject?.id || "subject"
    }`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalizeNotebook() {
    if (
      !notebook ||
      !Array.isArray(notebook.pages) ||
      !notebook.pages.length
    ) {
      notebook = freshNotebook();
    }

    notebook.pages.forEach((page) => {
      page.template ||= "lined";
      page.background ||= "#fffdf9";
      page.orientation ||= "portrait";
      page.strokes ||= [];
      page.elements ||= [];

      page.strokes.forEach((stroke) => {
        stroke.points ||= [];
        stroke.tool ||= "gel";
        stroke.color ||= "#4d4260";
        stroke.width ||= 3;
      });
    });
  }

  function loadLocal() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey()) || "null"
      );

      if (
        saved &&
        Array.isArray(saved.pages) &&
        saved.pages.length
      ) {
        return saved;
      }
    } catch (_) {}

    return freshNotebook();
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
        !data?.content ||
        !Array.isArray(data.content.pages) ||
        !mounted
      ) {
        return;
      }

      const cloudTime = Number(
        data.content.updatedAt || 0
      );

      const localTime = Number(
        notebook.updatedAt || 0
      );

      if (cloudTime > localTime) {
        notebook = data.content;
        normalizeNotebook();
        renderCanvas();
        updateStatus("Sincronizat");
      }
    } catch (_) {}
  }

  /*
   * IMPORTANT:
   *
   * Local persistence is synchronous but tiny.
   * Supabase NEVER runs while a Pencil stroke is active.
   */

  function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      if (drawing || pointers.size) {
        scheduleSave();
        return;
      }

      void persist();
    }, 1200);
  }

  function localSave() {
    try {
      notebook.updatedAt = Date.now();

      localStorage.setItem(
        storageKey(),
        JSON.stringify(notebook)
      );
    } catch (_) {}

    scheduleSave();
  }

  async function persist() {
    if (
      !mounted ||
      !user ||
      !subject ||
      drawing ||
      pointers.size
    ) {
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

      if (drawing || pointers.size) {
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
            : JSON.parse(
                JSON.stringify(notebook)
              );
      } catch (_) {
        break;
      }

      try {
        await supabaseClient
          .from("notebooks")
          .upsert(
            {
              user_id: user.id,
              subject_id: subject.id,
              content: snapshot,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "user_id,subject_id",
            }
          );

        if (
          mounted &&
          version === saveVersion &&
          !drawing &&
          !pointers.size
        ) {
          updateStatus("Salvat");
        }
      } catch (_) {
        updateStatus("Salvat local");
      }
    } while (
      saveQueued &&
      !drawing &&
      !pointers.size
    );

    saving = false;
  }

  function updateStatus(text) {
    root
      ?.querySelector("[data-notebook-status]")
      ?.replaceChildren(text);
  }

  function render() {
    if (!root || !notebook || !subject) {
      return;
    }

    injectStyles();

    const p = currentPage();

    root.innerHTML = `
      <a
        class="subjects-spa-back"
        href="#/subjects/${subject.id}"
      >
        ← ${escapeHtml(subject.name)}
      </a>

      <section
        class="notebook-shell"
        style="--nb-accent:${subject.color || "#f3a9c5"}"
      >
        <header class="notebook-head">
          <div class="notebook-title-icon">
            <svg viewBox="0 0 48 48">
              <path
                d="M12 18h24v10H12zM16 28l-3 12m19-12 3 12M12 40h8m8 0h8M19 13h10"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <div>
            <p class="eyebrow">Caietul tău</p>
            <h2>${escapeHtml(subject.name)}</h2>
          </div>

          <small data-notebook-status>
            Pregătit
          </small>
        </header>

        <div
          class="notebook-toolbar"
          data-notebook-toolbar
        >
          ${toolButton("gel", icons.gel, "Pix gel")}
          ${toolButton("ballpoint", icons.ballpoint, "Pix")}
          ${toolButton("pencil", icons.pencil, "Creion")}
          ${toolButton(
            "highlighter",
            icons.highlighter,
            "Marker"
          )}
          ${toolButton(
            "eraser",
            icons.eraser,
            "Radieră"
          )}
          ${toolButton("text", icons.text, "Text")}

          <button
            data-auto-shapes
            aria-pressed="${autoShapes}"
            title="Forme automate"
          >
            ${icons.shapes}
          </button>

          <button
            data-add-image
            title="Adaugă imagine"
          >
            ${icons.image}
          </button>

          <button
            data-undo
            title="Anulează"
          >
            ${icons.undo}
          </button>

          <button
            data-redo
            title="Refă"
          >
            ${icons.redo}
          </button>

          <button
            data-zoom-out
            title="Micșorează"
          >
            ${icons.zoomOut}
          </button>

          <span
            class="notebook-zoom"
            data-zoom
          >
            ${Math.round(zoom * 100)}%
          </span>

          <button
            data-zoom-in
            title="Mărește"
          >
            ${icons.zoomIn}
          </button>

          <input
            data-color
            type="color"
            value="${color}"
            title="Culoare"
          />

          <span class="notebook-swatches">
            ${palette
              .map(
                (c) => `
                  <button
                    type="button"
                    data-swatch="${c}"
                    style="background:${c}"
                    aria-label="Culoare"
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
            step=".5"
            value="${width}"
            title="Grosime"
          />

          <select data-shape title="Formă">
            <option value="">Liber</option>
            <option value="line">Linie</option>
            <option value="arrow">Săgeată</option>
            <option value="rectangle">
              Dreptunghi
            </option>
            <option value="ellipse">
              Elipsă
            </option>
            <option value="triangle">
              Triunghi
            </option>
          </select>

          <select data-template title="Pagină">
            ${Object.entries(templates)
              .map(
                ([id, label]) => `
                  <option
                    value="${id}"
                    ${
                      p.template === id
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

          <select data-orientation title="Orientare">
            <option
              value="portrait"
              ${
                p.orientation === "portrait"
                  ? "selected"
                  : ""
              }
            >
              A4 portret
            </option>

            <option
              value="landscape"
              ${
                p.orientation === "landscape"
                  ? "selected"
                  : ""
              }
            >
              A4 peisaj
            </option>
          </select>

          <button
            data-fullscreen
            class="notebook-fullscreen-button"
            title="Focus Mode"
            aria-label="Focus Mode"
          >
            ${icons.fullscreen}
          </button>

          <input
            data-image-input
            type="file"
            accept="image/*"
            hidden
          />
        </div>

        <div
          class="notebook-stage"
          data-notebook-stage
        >
          <div
            class="notebook-sheet"
            data-notebook-sheet
          >
            <canvas
              class="notebook-base-canvas"
              data-notebook-canvas
            ></canvas>

            <canvas
              class="notebook-ink-canvas"
              data-notebook-ink
            ></canvas>
          </div>
        </div>

        <div class="notebook-page-controls">
          <button data-prev>‹</button>

          <span data-page-label>
            Pagina ${activePage + 1}
            / ${notebook.pages.length}
          </span>

          <button data-next>›</button>
          <button data-add-page>＋</button>
        </div>
      </section>
    `;

    canvas = root.querySelector(
      "[data-notebook-canvas]"
    );

    inkCanvas = root.querySelector(
      "[data-notebook-ink]"
    );

    ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    inkCtx = inkCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });

    bind();

    resizeCanvas();

    renderCanvas();

    updateSwatches();

    setZoom(zoom);
  }

  function toolButton(id, icon, title) {
    return `
      <button
        data-tool="${id}"
        class="${tool === id ? "active" : ""}"
        title="${title}"
        aria-label="${title}"
      >
        ${icon}
      </button>
    `;
  }

  /*
   * ---------------------------------------------------------
   * CANVAS SIZE
   * ---------------------------------------------------------
   */

  function pageAspect() {
    return currentPage().orientation ===
      "landscape"
      ? 297 / 210
      : 210 / 297;
  }

  function resizeCanvas() {
    if (!canvas || !inkCanvas) {
      return;
    }

    const stage = root.querySelector(
      "[data-notebook-stage]"
    );

    const sheet = root.querySelector(
      "[data-notebook-sheet]"
    );

    if (!stage || !sheet) {
      return;
    }

    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;

    const aspect = pageAspect();

    let widthPx = stageWidth * 0.72;
    let heightPx = widthPx / aspect;

    if (heightPx > stageHeight * 0.9) {
      heightPx = stageHeight * 0.9;
      widthPx = heightPx * aspect;
    }

    if (widthPx < 280) {
      widthPx = 280;
      heightPx = widthPx / aspect;
    }

    sheet.style.width = `${widthPx}px`;
    sheet.style.height = `${heightPx}px`;

    const dpr = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.max(
      1,
      Math.round(widthPx * dpr)
    );

    const pixelHeight = Math.max(
      1,
      Math.round(heightPx * dpr)
    );

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    inkCanvas.width = pixelWidth;
    inkCanvas.height = pixelHeight;

    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;

    inkCanvas.style.width = `${widthPx}px`;
    inkCanvas.style.height = `${heightPx}px`;

    renderCanvas();
    clearInk();
  }

  /*
   * ---------------------------------------------------------
   * PAPER
   * ---------------------------------------------------------
   */

  function paintPaper() {
    if (!ctx || !canvas) {
      return;
    }

    const dpr = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    const w = canvas.width;
    const h = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle =
      currentPage().background || "#fffdf9";

    ctx.fillRect(0, 0, w, h);

    const template = currentPage().template;

    if (template === "blank") {
      return;
    }

    ctx.save();

    ctx.strokeStyle =
      template === "grid"
        ? "rgba(110,130,160,.12)"
        : "rgba(100,120,160,.18)";

    ctx.lineWidth = 1 * dpr;

    if (template === "grid") {
      const gap = 22 * dpr;

      for (let x = gap; x < w; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      for (let y = gap; y < h; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    } else {
      const gap = 31 * dpr;

      for (let y = gap; y < h; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.strokeStyle =
        "rgba(230,100,130,.16)";

      ctx.beginPath();
      ctx.moveTo(58 * dpr, 0);
      ctx.lineTo(58 * dpr, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  /*
   * ---------------------------------------------------------
   * DRAWING
   * ---------------------------------------------------------
   */

  function renderCanvas() {
    if (!ctx || !canvas) {
      return;
    }

    paintPaper();

    const dpr = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    currentPage().strokes.forEach((stroke) => {
      drawStroke(
        ctx,
        stroke,
        dpr
      );
    });

    currentPage().elements.forEach((element) => {
      drawElement(
        ctx,
        element,
        dpr
      );
    });

    clearInk();
  }

  function clearInk() {
    if (!inkCtx || !inkCanvas) {
      return;
    }

    inkCtx.setTransform(1, 0, 0, 1, 0, 0);

    inkCtx.clearRect(
      0,
      0,
      inkCanvas.width,
      inkCanvas.height
    );
  }

  /*
   * This is deliberately light.
   *
   * It does NOT wait for future points.
   * It only smooths the points that already exist.
   */

  function stabilizedPoints(points) {
    if (!points || points.length <= 2) {
      return points || [];
    }

    const result = [points[0]];

    const amount = 0.18;

    for (let i = 1; i < points.length - 1; i++) {
      const previous = points[i - 1];
      const current = points[i];
      const next = points[i + 1];

      result.push([
        current[0] +
          ((
            previous[0] +
            next[0]
          ) /
            2 -
            current[0]) *
            amount,

        current[1] +
          ((
            previous[1] +
            next[1]
          ) /
            2 -
            current[1]) *
            amount,

        current[2],
      ]);
    }

    result.push(points[points.length - 1]);

    return result;
  }

  function drawStroke(
    target,
    stroke,
    dpr
  ) {
    const points = stroke.points || [];

    if (!points.length) {
      return;
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const smooth =
      stabilizedPoints(points);

    const alpha =
      stroke.tool === "highlighter"
        ? 0.24
        : stroke.tool === "pencil"
        ? 0.72
        : 1;

    target.save();

    target.globalAlpha = alpha;

    target.strokeStyle =
      stroke.color || color;

    target.fillStyle =
      stroke.color || color;

    target.lineCap = "round";
    target.lineJoin = "round";

    /*
     * Tiny strokes need to appear immediately.
     */
    if (smooth.length === 1) {
      const p = smooth[0];

      const radius =
        Math.max(
          0.7,
          stroke.width *
            (Number(p[2]) || 1) *
            0.5
        );

      target.beginPath();

      target.arc(
        p[0] * w,
        p[1] * h,
        radius,
        0,
        Math.PI * 2
      );

      target.fill();

      target.restore();
      return;
    }

    for (let i = 1; i < smooth.length; i++) {
      const a = smooth[i - 1];
      const b = smooth[i];

      const next =
        smooth[i + 1] || b;

      const pressure =
        (
          Number(a[2]) || 1
        ) +
        (
          Number(b[2]) || 1
        );

      const averagePressure =
        pressure / 2;

      target.lineWidth =
        stroke.width *
        averagePressure *
        dpr;

      const ax = a[0] * w * dpr;
      const ay = a[1] * h * dpr;

      const bx = b[0] * w * dpr;
      const by = b[1] * h * dpr;

      const nx =
        (
          b[0] +
          next[0]
        ) /
        2 *
        w *
        dpr;

      const ny =
        (
          b[1] +
          next[1]
        ) /
        2 *
        h *
        dpr;

      target.beginPath();

      target.moveTo(ax, ay);

      if (i < smooth.length - 1) {
        target.quadraticCurveTo(
          bx,
          by,
          nx,
          ny
        );
      } else {
        target.lineTo(bx, by);
      }

      target.stroke();
    }

    target.restore();
  }

  function drawElement(
    target,
    element,
    dpr
  ) {
    if (element.type === "text") {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      target.save();

      target.fillStyle =
        element.color || "#171717";

      target.font =
        `${element.size || 18}px system-ui, -apple-system, sans-serif`;

      target.textBaseline = "top";

      target.fillText(
        element.text,
        element.x * w,
        element.y * h
      );

      target.restore();

      return;
    }

    if (element.type === "image") {
      drawImageElement(
        target,
        element,
        dpr
      );

      return;
    }

    if (element.type === "shape") {
      drawShape(
        target,
        element,
        dpr
      );
    }
  }

  function drawShape(
    target,
    shape,
    dpr
  ) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const x = shape.x * w;
    const y = shape.y * h;
    const sw = shape.w * w;
    const sh = shape.h * h;

    target.save();

    target.strokeStyle =
      shape.color || color;

    target.lineWidth =
      (shape.width || 3) * dpr;

    target.lineCap = "round";
    target.lineJoin = "round";

    target.beginPath();

    if (shape.shape === "line") {
      target.moveTo(x, y);
      target.lineTo(
        x + sw,
        y + sh
      );
    }

    if (shape.shape === "arrow") {
      drawArrow(
        target,
        x,
        y,
        x + sw,
        y + sh
      );
    }

    if (shape.shape === "rectangle") {
      target.rect(
        x,
        y,
        sw,
        sh
      );
    }

    if (shape.shape === "ellipse") {
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

    if (shape.shape === "triangle") {
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
    target.restore();
  }

  function drawArrow(
    target,
    x1,
    y1,
    x2,
    y2
  ) {
    const angle = Math.atan2(
      y2 - y1,
      x2 - x1
    );

    const size = 9;

    target.moveTo(x1, y1);
    target.lineTo(x2, y2);

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        size *
          Math.cos(angle - Math.PI / 6),
      y2 -
        size *
          Math.sin(angle - Math.PI / 6)
    );

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        size *
          Math.cos(angle + Math.PI / 6),
      y2 -
        size *
          Math.sin(angle + Math.PI / 6)
    );
  }

  const imageCache = new Map();

  function drawImageElement(
    target,
    element
  ) {
    let image = imageCache.get(
      element.src
    );

    if (!image) {
      image = new Image();

      image.onload = () => {
        renderCanvas();
      };

      image.src = element.src;

      imageCache.set(
        element.src,
        image
      );

      return;
    }

    if (!image.complete) {
      return;
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    target.drawImage(
      image,
      element.x * w,
      element.y * h,
      element.w * w,
      element.h * h
    );
  }

  /*
   * ---------------------------------------------------------
   * POINTER MAPPING
   * ---------------------------------------------------------
   */

  function pointFromEvent(event) {
    const rect =
      inkCanvas.getBoundingClientRect();

    return [
      Math.max(
        0,
        Math.min(
          1,
          (event.clientX - rect.left) /
            rect.width
        )
      ),

      Math.max(
        0,
        Math.min(
          1,
          (event.clientY - rect.top) /
            rect.height
        )
      ),

      event.pointerType === "pen" &&
      Number.isFinite(event.pressure) &&
      event.pressure > 0
        ? Math.max(
            0.2,
            Math.min(
              1.8,
              event.pressure * 1.45
            )
          )
        : 1,
    ];
  }

  /*
   * ---------------------------------------------------------
   * LIVE INK
   * ---------------------------------------------------------
   */

  function drawLive() {
    if (!drawing || !inkCtx) {
      return;
    }

    clearInk();

    const dpr = Math.min(
      global.devicePixelRatio || 1,
      2
    );

    drawStroke(
      inkCtx,
      drawing,
      dpr
    );
  }

  function addSamples(events) {
    if (!drawing) {
      return;
    }

    for (const event of events) {
      const p =
        pointFromEvent(event);

      const last =
        drawing.points[
          drawing.points.length - 1
        ];

      /*
       * Only reject EXACT duplicate samples.
       *
       * This is important for:
       * - i dots
       * - t crosses
       * - punctuation
       * - tiny strokes
       */
      if (
        last &&
        p[0] === last[0] &&
        p[1] === last[1]
      ) {
        continue;
      }

      drawing.points.push(p);
    }

    drawLive();
  }

  function begin(event) {
    if (!canvas || !inkCanvas) {
      return;
    }

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
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
     * Touch is reserved for navigation/pan.
     * Pencil gets priority.
     */
    if (
      event.pointerType === "touch"
    ) {
      return;
    }

    if (
      event.pointerType === "pen" ||
      event.pointerType === "mouse"
    ) {
      try {
        inkCanvas.setPointerCapture(
          event.pointerId
        );
      } catch (_) {}

      if (tool === "text") {
        addText(event);
        return;
      }

      if (tool === "eraser") {
        eraseAt(
          pointFromEvent(event)
        );
        return;
      }

      redo = [];

      drawing = {
        tool,
        color,
        width:
          tool === "highlighter"
            ? width * 3
            : width,
        points: [],
      };

      currentPage().strokes.push(
        drawing
      );

      /*
       * First point is rendered immediately.
       */
      addSamples([event]);
    }
  }

  function move(event) {
    if (!pointers.has(event.pointerId)) {
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
     * Touch = navigation only.
     */
    if (
      event.pointerType === "touch"
    ) {
      return;
    }

    if (!drawing) {
      if (tool === "eraser") {
        eraseAt(
          pointFromEvent(event)
        );
      }

      return;
    }

    /*
     * The browser may have several Pencil
     * samples waiting between animation frames.
     *
     * We take ALL of them.
     */
    const events =
      typeof event.getCoalescedEvents ===
      "function"
        ? event.getCoalescedEvents()
        : [event];

    addSamples(events);
  }

  function finish(event) {
    pointers.delete(
      event.pointerId
    );

    if (
      drawing &&
      event.pointerId ===
        drawing.pointerId
    ) {
      drawing = null;
    }

    if (
      drawing &&
      event.pointerType === "pen"
    ) {
      addSamples([event]);
    }

    try {
      inkCanvas.releasePointerCapture(
        event.pointerId
      );
    } catch (_) {}

    if (
      event.pointerType === "pen" ||
      event.pointerType === "mouse"
    ) {
      /*
       * Move the finished stroke to the static
       * layer immediately.
       */
      renderCanvas();

      /*
       * Local save is deferred until after
       * the stroke. Supabase is even later.
       */
      localSave();
    }

    if (!pointers.size) {
      drawing = null;
    }
  }

  /*
   * ---------------------------------------------------------
   * ERASER
   * ---------------------------------------------------------
   */

  function eraseAt(at) {
    const p = currentPage();

    const radius =
      Math.max(
        0.008,
        width /
          Math.max(
            canvas.clientWidth,
            canvas.clientHeight
          ) *
          2.5
      );

    const removed = [];

    p.strokes =
      p.strokes.filter((stroke) => {
        const hit =
          stroke.points.some(
            (point) =>
              Math.hypot(
                point[0] - at[0],
                point[1] - at[1]
              ) < radius
          );

        if (hit) {
          removed.push(stroke);
        }

        return !hit;
      });

    if (!removed.length) {
      return;
    }

    redo.push(
      ...removed
    );

    renderCanvas();
    localSave();
  }

  /*
   * ---------------------------------------------------------
   * SHAPES
   * ---------------------------------------------------------
   */

  function recognizeShape(stroke) {
    const points =
      stroke.points || [];

    if (points.length < 4) {
      return null;
    }

    const first = points[0];
    const last =
      points[points.length - 1];

    const minX = Math.min(
      ...points.map((p) => p[0])
    );

    const maxX = Math.max(
      ...points.map((p) => p[0])
    );

    const minY = Math.min(
      ...points.map((p) => p[1])
    );

    const maxY = Math.max(
      ...points.map((p) => p[1])
    );

    const w = maxX - minX;
    const h = maxY - minY;

    const closed =
      Math.hypot(
        first[0] - last[0],
        first[1] - last[1]
      ) < 0.055;

    const near = (x, y) =>
      points.some(
        (p) =>
          Math.hypot(
            p[0] - x,
            p[1] - y
          ) < 0.045
      );

    if (closed) {
      const rectangle =
        near(minX, minY) &&
        near(maxX, minY) &&
        near(maxX, maxY) &&
        near(minX, maxY);

      const triangle =
        near(
          (minX + maxX) / 2,
          minY
        ) &&
        near(minX, maxY) &&
        near(maxX, maxY);

      return {
        type: "shape",
        shape: rectangle
          ? "rectangle"
          : triangle
          ? "triangle"
          : "ellipse",
        x: minX,
        y: minY,
        w: Math.max(w, 0.001),
        h: Math.max(h, 0.001),
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

    if (!length) {
      return null;
    }

    const deviation =
      points.reduce(
        (sum, p) => {
          const distance =
            Math.abs(
              dy * p[0] -
                dx * p[1] +
                last[0] * first[1] -
                last[1] * first[0]
            ) / length;

          return sum + distance;
        },
        0
      ) / points.length;

    if (deviation < 0.01) {
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

  function applyShapeRecognition() {
    if (!drawing) {
      return;
    }

    if (!autoShapes && !shapeTool) {
      return;
    }

    const stroke =
      drawing;

    const shape =
      shapeTool
        ? makeManualShape(
            stroke,
            shapeTool
          )
        : recognizeShape(stroke);

    if (!shape) {
      return;
    }

    const index =
      currentPage().strokes.indexOf(
        stroke
      );

    if (index >= 0) {
      currentPage().strokes.splice(
        index,
        1
      );
    }

    currentPage().elements.push(
      shape
    );
  }

  function makeManualShape(
    stroke,
    selected
  ) {
    const points =
      stroke.points || [];

    if (points.length < 2) {
      return null;
    }

    const xs = points.map(
      (p) => p[0]
    );

    const ys = points.map(
      (p) => p[1]
    );

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      type: "shape",
      shape: selected,
      x: minX,
      y: minY,
      w: Math.max(
        maxX - minX,
        0.001
      ),
      h: Math.max(
        maxY - minY,
        0.001
      ),
      color: stroke.color,
      width: stroke.width,
    };
  }

  /*
   * ---------------------------------------------------------
   * TEXT
   * ---------------------------------------------------------
   */

  function addText(event) {
    const at =
      pointFromEvent(event);

    const input =
      document.createElement("input");

    input.className =
      "notebook-text-editor";

    input.placeholder =
      "Scrie aici";

    input.style.left =
      `${event.clientX}px`;

    input.style.top =
      `${event.clientY}px`;

    document.body.appendChild(
      input
    );

    input.focus();

    let finished = false;

    const commit = () => {
      if (finished) {
        return;
      }

      finished = true;

      const value =
        input.value.trim();

      input.remove();

      if (!value) {
        return;
      }

      currentPage().elements.push({
        type: "text",
        text: value,
        x: at[0],
        y: at[1],
        color,
        size: Math.max(
          16,
          width * 5
        ),
      });

      renderCanvas();
      localSave();
    };

    input.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          commit();
        }

        if (e.key === "Escape") {
          finished = true;
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
   * IMAGE
   * ---------------------------------------------------------
   */

  function addImage(file) {
    if (!file) {
      return;
    }

    const reader =
      new FileReader();

    reader.onload = () => {
      const src =
        reader.result;

      const image =
        new Image();

      image.onload = () => {
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

        const offCtx =
          off.getContext("2d");

        offCtx.drawImage(
          image,
          0,
          0,
          off.width,
          off.height
        );

        currentPage().elements.push({
          type: "image",
          src: off.toDataURL(
            "image/jpeg",
            0.82
          ),
          x: 0.12,
          y: 0.12,
          w: 0.76,
          h: Math.min(
            0.7,
            0.76 *
              (off.height /
                off.width)
          ),
        });

        renderCanvas();
        localSave();

        updateStatus(
          "Imagine adăugată"
        );
      };

      image.src = src;
    };

    reader.readAsDataURL(file);
  }

  /*
   * ---------------------------------------------------------
   * ZOOM
   * ---------------------------------------------------------
   */

  function setZoom(value) {
    zoom = Math.max(
      0.55,
      Math.min(
        3.5,
        value
      )
    );

    const sheet =
      root?.querySelector(
        "[data-notebook-sheet]"
      );

    if (!sheet) {
      return;
    }

    sheet.style.transform =
      `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

    const label =
      root.querySelector(
        "[data-zoom]"
      );

    if (label) {
      label.textContent =
        `${Math.round(zoom * 100)}%`;
    }
  }

  /*
   * ---------------------------------------------------------
   * FULLSCREEN / FOCUS MODE
   * ---------------------------------------------------------
   */

  function setFullscreen(value) {
    fullscreen = value;

    const shell =
      root.querySelector(
        ".notebook-shell"
      );

    const toolbar =
      root.querySelector(
        "[data-notebook-toolbar]"
      );

    if (!shell) {
      return;
    }

    shell.classList.toggle(
      "notebook-focus",
      fullscreen
    );

    if (fullscreen) {
      document.body.style.overflow =
        "hidden";

      const button =
        root.querySelector(
          "[data-fullscreen]"
        );

      if (button) {
        button.innerHTML =
          icons.exitFullscreen;

        button.title =
          "Ieși din Focus Mode";
      }

      toolbar?.classList.remove(
        "hidden"
      );

      scheduleToolbarHide();
    } else {
      document.body.style.overflow =
        "";

      const button =
        root.querySelector(
          "[data-fullscreen]"
        );

      if (button) {
        button.innerHTML =
          icons.fullscreen;

        button.title =
          "Focus Mode";
      }

      toolbar?.classList.remove(
        "hidden"
      );
    }

    requestAnimationFrame(() => {
      resizeCanvas();
      setZoom(zoom);
    });
  }

  function scheduleToolbarHide() {
    if (!fullscreen) {
      return;
    }

    clearTimeout(
      toolbarHideTimer
    );

    toolbarHideTimer =
      setTimeout(() => {
        if (!fullscreen) {
          return;
        }

        root
          ?.querySelector(
            "[data-notebook-toolbar]"
          )
          ?.classList.add(
            "hidden"
          );
      }, 2600);
  }

  function wakeToolbar() {
    if (!fullscreen) {
      return;
    }

    const toolbar =
      root.querySelector(
        "[data-notebook-toolbar]"
      );

    toolbar?.classList.remove(
      "hidden"
    );

    scheduleToolbarHide();
  }

  /*
   * ---------------------------------------------------------
   * BINDINGS
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

            wakeToolbar();
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
          currentPage().template =
            event.target.value;

          renderCanvas();
          localSave();
        }
      );

    root
      .querySelector(
        "[data-orientation]"
      )
      .addEventListener(
        "change",
        (event) => {
          currentPage().orientation =
            event.target.value;

          zoom = 1;
          pan = {
            x: 0,
            y: 0,
          };

          render();

          localSave();
        }
      );

    root
      .querySelector(
        "[data-undo]"
      )
      .addEventListener(
        "click",
        () => {
          /*
           * Undo the most recently created
           * object across both arrays.
           */
          const strokes =
            currentPage().strokes;

          const elements =
            currentPage().elements;

          const lastStroke =
            strokes[strokes.length - 1];

          const lastElement =
            elements[elements.length - 1];

          if (
            !lastStroke &&
            !lastElement
          ) {
            return;
          }

          const strokeTime =
            lastStroke?.createdAt ||
            0;

          const elementTime =
            lastElement?.createdAt ||
            0;

          /*
           * Old notebooks don't necessarily
           * have createdAt, so strokes are
           * preferred when timestamps are absent.
           */
          if (
            lastElement &&
            elementTime > strokeTime
          ) {
            redo.push(
              elements.pop()
            );
          } else {
            redo.push(
              strokes.pop()
            );
          }

          renderCanvas();
          localSave();
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

          if (item.type) {
            currentPage().elements.push(
              item
            );
          } else {
            currentPage().strokes.push(
              item
            );
          }

          renderCanvas();
          localSave();
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
        "[data-fullscreen]"
      )
      .addEventListener(
        "click",
        () => {
          setFullscreen(
            !fullscreen
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
          addImage(
            event.target.files?.[0]
          );

          event.target.value = "";
        }
      );

    root
      .querySelector(
        "[data-prev]"
      )
      .addEventListener(
        "click",
        () => {
          if (activePage <= 0) {
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
              currentPage().template,

            background:
              currentPage().background,

            orientation:
              currentPage().orientation,

            strokes: [],
            elements: [],
          });

          activePage =
            notebook.pages.length - 1;

          zoom = 1;

          pan = {
            x: 0,
            y: 0,
          };

          redo = [];

          render();
          localSave();
        }
      );

    /*
     * -----------------------------------------------------
     * Pencil events
     * -----------------------------------------------------
     */

    inkCanvas.addEventListener(
      "pointerdown",
      begin,
      { passive: false }
    );

    inkCanvas.addEventListener(
      "pointermove",
      move,
      { passive: false }
    );

    inkCanvas.addEventListener(
      "pointerup",
      finish,
      { passive: true }
    );

    inkCanvas.addEventListener(
      "pointercancel",
      finish,
      { passive: true }
    );

    inkCanvas.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
      }
    );

    /*
     * Wake toolbar when the user moves
     * toward the top in Focus Mode.
     */
    root.addEventListener(
      "pointermove",
      (event) => {
        if (
          fullscreen &&
          event.clientY < 100
        ) {
          wakeToolbar();
        }
      },
      { passive: true }
    );

    /*
     * Escape exits Focus Mode.
     */
    document.addEventListener(
      "keydown",
      handleKeydown
    );

    if (
      typeof ResizeObserver !==
      "undefined"
    ) {
      resizeObserver =
        new ResizeObserver(() => {
          resizeCanvas();
        });

      resizeObserver.observe(
        root.querySelector(
          "[data-notebook-stage]"
        )
      );
    }

    updateSwatches();
  }

  function handleKeydown(event) {
    if (
      event.key === "Escape" &&
      fullscreen
    ) {
      setFullscreen(false);
    }

    if (
      (event.metaKey ||
        event.ctrlKey) &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();

      root
        ?.querySelector(
          "[data-undo]"
        )
        ?.click();
    }

    if (
      (event.metaKey ||
        event.ctrlKey) &&
      event.key.toLowerCase() === "y"
    ) {
      event.preventDefault();

      root
        ?.querySelector(
          "[data-redo]"
        )
        ?.click();
    }
  }

  function updateSwatches() {
    root
      ?.querySelectorAll(
        "[data-swatch]"
      )
      .forEach((button) => {
        const selected =
          button.dataset.swatch.toLowerCase() ===
          color.toLowerCase();

        button.classList.toggle(
          "notebook-swatch-selected",
          selected
        );

        button.setAttribute(
          "aria-pressed",
          String(selected)
        );
      });
  }

  /*
   * ---------------------------------------------------------
   * MOUNT
   * ---------------------------------------------------------
   */

  async function mount(subjectId) {
    root =
      document.getElementById(
        "notebookViewRoot"
      );

    if (!root) {
      return;
    }

    mounted = true;

    root.innerHTML = `
      <div class="subjects-spa-state">
        Se deschide caietul…
      </div>
    `;

    const {
      data: { session },
    } =
      await supabaseClient.auth.getSession();

    if (!mounted) {
      return;
    }

    user = session?.user;

    if (!user) {
      root.innerHTML = `
        <div class="subjects-spa-state">
          Trebuie să fii autentificat.
        </div>
      `;

      return;
    }

    const { data } =
      await supabaseClient
        .from("subjects")
        .select(
          "id,name,color"
        )
        .eq("id", subjectId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (!mounted) {
      return;
    }

    if (!data) {
      root.innerHTML = `
        <div class="subjects-spa-state">
          Caietul nu a fost găsit.
        </div>
      `;

      return;
    }

    subject = data;

    notebook =
      loadLocal();

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

  /*
   * ---------------------------------------------------------
   * UNMOUNT
   * ---------------------------------------------------------
   */

  function unmount() {
    clearTimeout(
      saveTimer
    );

    clearTimeout(
      toolbarHideTimer
    );

    if (notebook) {
      try {
        localStorage.setItem(
          storageKey(),
          JSON.stringify(notebook)
        );
      } catch (_) {}
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    document.removeEventListener(
      "keydown",
      handleKeydown
    );

    document.body.style.overflow =
      "";

    mounted = false;

    root = null;
    canvas = null;
    ctx = null;
    inkCanvas = null;
    inkCtx = null;

    drawing = null;

    pointers.clear();
  }

  global.IteraNotebookView =
    Object.freeze({
      mount,
      unmount,
    });
})(window);