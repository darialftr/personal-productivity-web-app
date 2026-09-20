"use strict";

/*
 * ITERA NOTEBOOK
 *
 * Low-latency Apple Pencil notebook engine.
 *
 * IMPORTANT:
 * - Drawing never waits for Supabase.
 * - Pointer samples are never artificially filtered by distance.
 * - getCoalescedEvents() is used when available.
 * - Live ink is drawn on a transparent second canvas.
 * - Static page content is kept on the base canvas.
 * - Small strokes / dots are preserved.
 * - Smoothing is intentionally light and causal enough
 *   to avoid making handwriting feel delayed.
 * - Fullscreen uses the browser Fullscreen API when available,
 *   with a CSS Focus Mode fallback.
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
  let eraserChanged = false;

  /*
   * Redo history.
   * Every item has:
   * {
   *   kind: "stroke" | "element",
   *   item: object
   * }
   */
  let redo = [];

  let mounted = false;

  let zoom = 1;

  let pan = {
    x: 0,
    y: 0,
  };

  let saveTimer = 0;
  let saving = false;
  let saveQueued = false;
  let saveVersion = 0;
  let localCacheTimer = 0;

  let resizeObserver = null;

  let fullscreen = false;
  let toolbarHideTimer = 0;

  let autoShapes = false;
  let shapeTool = "";

  /*
   * Touch pointers are navigation.
   * Pencil / mouse are drawing.
   */
  const pointers = new Map();

  const imageCache = new Map();

  /*
   * ---------------------------------------------------------
   * COLORS
   * ---------------------------------------------------------
   */

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

  /*
   * ---------------------------------------------------------
   * PAGE TEMPLATES
   * ---------------------------------------------------------
   */

  const templates = {
    lined: "Liniat",
    grid: "Pătrățele",
    blank: "Simplu",
  };

  /*
   * ---------------------------------------------------------
   * STYLES
   * ---------------------------------------------------------
   */

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

      flex: 0 0 auto;

      display: grid;
      place-items: center;

      border-radius: 15px;

      background:
        color-mix(
          in srgb,
          var(--nb-accent) 22%,
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

      font-size: 11px;
      opacity: .55;
    }

    /*
     * -------------------------------------------------------
     * NORMAL TOOLBAR
     * -------------------------------------------------------
     */

    .notebook-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;

      gap: 6px;

      padding: 8px;

      border-radius: 22px;

      margin-bottom: 14px;

      background:
        color-mix(
          in srgb,
          var(--surface, #fff) 90%,
          var(--nb-accent) 10%
        );

      border: 1px solid
        color-mix(
          in srgb,
          var(--nb-accent) 18%,
          transparent
        );

      box-shadow:
        0 8px 28px rgba(0, 0, 0, .07),
        inset 0 1px 0 rgba(255, 255, 255, .75);

      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
    }

    .notebook-toolbar button {
      width: 38px;
      height: 38px;

      flex: 0 0 auto;

      border: 0;
      border-radius: 14px;

      display: grid;
      place-items: center;

      padding: 0;

      background: transparent;
      color: currentColor;

      cursor: pointer;

      -webkit-tap-highlight-color: transparent;

      transition:
        transform .12s ease,
        background .12s ease,
        color .12s ease,
        box-shadow .12s ease;
    }

    .notebook-toolbar button:hover {
      background: rgba(127, 127, 127, .10);
      transform: scale(1.04);
    }

    .notebook-toolbar button:active {
      transform: scale(.91);
    }

    .notebook-toolbar button.active {
      background: var(--nb-accent);
      color: white;

      box-shadow:
        0 4px 14px
        color-mix(
          in srgb,
          var(--nb-accent) 38%,
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
      width: 72px;

      accent-color: var(--nb-accent);
    }
    .notebook-width-control {
  position: relative;
  display: flex;
  align-items: center;
}

.notebook-width-toggle {
  position: relative;
}

.notebook-width-preview {
  display: block;
  width: 8px;
  height: 8px;
  min-width: 4px;
  min-height: 4px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 1px rgba(0,0,0,.06);
  transition: width .12s ease, height .12s ease;
}

.notebook-width-popover {
  position: absolute;
  top: calc(100% + 9px);
  left: 50%;
  z-index: 1000030;

  width: 154px;
  padding: 10px 11px 9px;

  border-radius: 17px;

  background: rgba(255,255,255,.90);
  border: 1px solid rgba(255,255,255,.92);

  box-shadow:
    0 12px 34px rgba(0,0,0,.15),
    inset 0 1px 0 rgba(255,255,255,.95);

  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);

  transform:
    translateX(-50%)
    translateY(-4px)
    scale(.97);

  opacity: 0;
  pointer-events: none;

  transition:
    opacity .14s ease,
    transform .14s ease;
}

.notebook-width-control.open .notebook-width-popover {
  opacity: 1;
  pointer-events: auto;

  transform:
    translateX(-50%)
    translateY(0)
    scale(1);
}

.notebook-width-label {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: 7px;

  font-size: 10px;
  opacity: .68;
}

.notebook-width-popover input[type="range"] {
  display: block !important;
  width: 100% !important;
  margin: 2px 0 7px;

  accent-color: var(--nb-accent);
}

.notebook-width-dots {
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 0 2px;

  opacity: .42;
}

.notebook-width-dots i {
  display: block;

  width: 4px;
  height: 4px;

  border-radius: 50%;
  background: currentColor;
}

.notebook-width-dots i:nth-child(2) {
  width: 6px;
  height: 6px;
}

.notebook-width-dots i:nth-child(3) {
  width: 8px;
  height: 8px;
}

.notebook-width-dots i:nth-child(4) {
  width: 11px;
  height: 11px;
}

.notebook-width-dots i:nth-child(5) {
  width: 14px;
  height: 14px;
}

    .notebook-toolbar input[type="color"] {
      width: 29px;
      height: 29px;

      border: 0;
      padding: 0;

      border-radius: 50%;

      overflow: hidden;

      background: transparent;

      cursor: pointer;
    }

    .notebook-toolbar select {
      height: 34px;

      border: 0;
      border-radius: 12px;

      padding: 0 9px;

      background: rgba(127, 127, 127, .09);

      color: inherit;

      font-size: 12px;

      outline: none;
    }

    .notebook-zoom {
      min-width: 42px;

      text-align: center;

      font-size: 11px;

      opacity: .6;
    }

    /*
     * -------------------------------------------------------
     * COLOR SWATCHES
     * -------------------------------------------------------
     */

    .notebook-swatches {
      display: flex;
      align-items: center;

      gap: 7px;

      padding: 0 5px;
    }

    .notebook-toolbar
    .notebook-swatches
    button {
      width: 20px;
      height: 20px;

      min-width: 20px;

      padding: 0;

      border-radius: 50%;

      border: 2px solid
        rgba(255, 255, 255, .82);

      box-shadow:
        0 1px 3px rgba(0, 0, 0, .12);

      transform: none;
    }

    .notebook-toolbar
    .notebook-swatches
    button:hover {
      transform: scale(1.10);
    }

    .notebook-toolbar
    .notebook-swatches
    button.notebook-swatch-selected {
      transform: scale(1.20);

      outline:
        2px solid var(--nb-accent);

      outline-offset: 2px;
    }

    /*
     * -------------------------------------------------------
     * STAGE
     * -------------------------------------------------------
     */

    .notebook-stage {
      position: relative;

      width: 100%;

      height: min(76vh, 920px);

      min-height: 500px;

      overflow: hidden;

      border-radius: 25px;

      background:
        rgba(127, 127, 127, .07);

      touch-action: none;

      overscroll-behavior: none;

      user-select: none;
      -webkit-user-select: none;

      -webkit-touch-callout: none;
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
        0 16px 50px rgba(0, 0, 0, .13),
        0 2px 8px rgba(0, 0, 0, .06);

      border-radius: 4px;

      overflow: hidden;

      will-change: transform;
    }

    .notebook-sheet canvas {
      position: absolute;

      inset: 0;

      display: block;

      width: 100%;
      height: 100%;

      touch-action: none;

      user-select: none;
      -webkit-user-select: none;

      -webkit-touch-callout: none;

      /*
       * Prevent browser gestures from competing
       * with Apple Pencil input.
       */
      -webkit-user-drag: none;
    }

    .notebook-base-canvas {
      pointer-events: none;
    }

    .notebook-ink-canvas {
      pointer-events: auto;
    }

    /*
     * -------------------------------------------------------
     * PAGE CONTROLS
     * -------------------------------------------------------
     */

    .notebook-page-controls {
      display: flex;
      align-items: center;
      justify-content: center;

      gap: 9px;

      margin-top: 10px;
    }

    .notebook-page-controls button {
      width: 38px;
      height: 34px;

      border: 0;
      border-radius: 13px;

      background:
        rgba(127, 127, 127, .09);

      color: inherit;

      cursor: pointer;

      transition:
        transform .12s ease,
        background .12s ease;
    }

    .notebook-page-controls button:hover {
      background:
        rgba(127, 127, 127, .15);
    }

    .notebook-page-controls button:active {
      transform: scale(.92);
    }

    .notebook-page-label {
      min-width: 90px;

      text-align: center;

      font-size: 11px;

      opacity: .55;
    }

    /*
     * -------------------------------------------------------
     * FULLSCREEN / FOCUS MODE
     * -------------------------------------------------------
     */

    .notebook-fullscreen-button {
      margin-left: auto;
    }

    .notebook-focus {
      position: fixed !important;

      inset: 0 !important;

      z-index: 999999 !important;

      width: 100vw !important;
      height: 100dvh !important;

      min-height: 100dvh !important;

      box-sizing: border-box;

      padding:
        max(10px, env(safe-area-inset-top))
        max(10px, env(safe-area-inset-right))
        max(10px, env(safe-area-inset-bottom))
        max(10px, env(safe-area-inset-left))
        !important;

      background:
        var(--background, #f7f5f8);
    }

    .notebook-focus .notebook-head,
    .notebook-focus .subjects-spa-back {
      display: none !important;
    }

    .notebook-focus .notebook-toolbar {
      position: fixed;

      z-index: 1000001;

      top:
        max(10px, env(safe-area-inset-top));

      left: 50%;

      width: max-content;

      max-width:
        calc(100vw - 24px);

      margin: 0;

      padding: 7px;

      flex-wrap: nowrap;

      overflow-x: auto;

      scrollbar-width: none;

      border-radius: 25px;

      background:
        rgba(255, 255, 255, .72);

      color: #171717;

      border:
        1px solid
        rgba(255, 255, 255, .8);

      box-shadow:
        0 12px 38px
        rgba(0, 0, 0, .12),

        inset 0 1px 0
        rgba(255, 255, 255, .95);

      backdrop-filter:
        blur(25px)
        saturate(160%);

      -webkit-backdrop-filter:
        blur(25px)
        saturate(160%);

      transform:
        translateX(-50%);

      transition:
        opacity .18s ease,
        transform .18s ease;
    }

    .notebook-focus
    .notebook-toolbar::-webkit-scrollbar {
      display: none;
    }

    .notebook-focus
    .notebook-toolbar.hidden {
      opacity: 0;

      pointer-events: none;

      transform:
        translateX(-50%)
        translateY(-12px)
        scale(.97);
    }

    .notebook-focus
    .notebook-toolbar button {
      width: 37px;
      height: 37px;

      border-radius: 14px;
    }

    .notebook-focus
    .notebook-toolbar button.active {
      background: var(--nb-accent);
      color: white;
    }

    .notebook-focus
    .notebook-toolbar select,
    .notebook-focus
    .notebook-toolbar input[type="range"] {
      display: none;
    }

    .notebook-focus .notebook-stage {
      position: fixed;

      inset: 0;

      width: 100vw;
      height: 100dvh;

      min-height: 0;

      border-radius: 0;

      background:
        var(--background, #f7f5f8);
    }

    /*
     * -------------------------------------------------------
     * PAGE NAVIGATION
     * -------------------------------------------------------
     */

    .notebook-pages {
      display: flex;

      align-items: center;
      justify-content: center;

      gap: 8px;

      margin-top: 10px;
    }

    .notebook-pages button {
      width: 36px;
      height: 34px;

      border: 0;

      border-radius: 12px;

      background:
        rgba(127, 127, 127, .09);

      color: inherit;

      cursor: pointer;
    }

    .notebook-pages button:hover {
      background:
        rgba(127, 127, 127, .15);
    }

    /*
     * -------------------------------------------------------
     * PAGE THUMBNAILS
     * -------------------------------------------------------
     */

    .notebook-page-strip {
      display: flex;

      gap: 8px;

      overflow-x: auto;

      padding:
        8px 2px 4px;

      scrollbar-width: none;
    }

    .notebook-page-strip::-webkit-scrollbar {
      display: none;
    }

    .notebook-page-thumb {
      position: relative;

      flex: 0 0 auto;

      width: 48px;
      height: 64px;

      border-radius: 8px;

      border:
        2px solid transparent;

      overflow: hidden;

      background: white;

      box-shadow:
        0 2px 8px
        rgba(0, 0, 0, .08);

      cursor: pointer;
    }

    .notebook-page-thumb.active {
      border-color:
        var(--nb-accent);
    }

    .notebook-page-thumb canvas {
      width: 100%;
      height: 100%;

      display: block;
    }

    /*
     * -------------------------------------------------------
     * MOBILE
     * -------------------------------------------------------
     */

    @media (max-width: 720px) {
      .notebook-shell {
        padding: 10px;
      }

      .notebook-toolbar {
        gap: 5px;

        padding: 7px;

        border-radius: 20px;
      }

      .notebook-toolbar button {
        width: 35px;
        height: 35px;

        border-radius: 13px;
      }

      .notebook-stage {
        height: calc(100dvh - 220px);

        min-height: 430px;

        border-radius: 20px;
      }

      .notebook-head small {
        display: none;
      }
    }
  `;

  /*
   * ---------------------------------------------------------
   * HELPERS
   * ---------------------------------------------------------
   */

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function currentPage() {
    if (!notebook?.pages?.length) {
      return null;
    }

    return notebook.pages[
      clamp(
        activePage,
        0,
        notebook.pages.length - 1
      )
    ];
  }

  function storageKey() {
    return (
      "itera_notebook_" +
      String(subject?.id || "default")
    );
  }

  function pageSize() {
    return {
      width: 794,
      height: 1123,
    };
  }

  function createPage() {
    return {
      id:
        "page_" +
        Date.now() +
        "_" +
        Math.random()
          .toString(36)
          .slice(2),

      template: "lined",

      orientation: "portrait",

      strokes: [],

      elements: [],
    };
  }

  function createNotebook() {
    return {
      version: 3,

      pages: [
        createPage(),
      ],

      activePage: 0,

      updatedAt: Date.now(),
    };
  }

  function ensureNotebook() {
    if (!notebook) {
      notebook = createNotebook();
    }

    if (!Array.isArray(notebook.pages)) {
      notebook.pages = [
        createPage(),
      ];
    }

    if (!notebook.pages.length) {
      notebook.pages.push(
        createPage()
      );
    }

    activePage = clamp(
      Number(
        notebook.activePage ?? 0
      ),
      0,
      notebook.pages.length - 1
    );

    notebook.pages.forEach(
      (page) => {
        if (!Array.isArray(page.strokes)) {
          page.strokes = [];
        }

        if (!Array.isArray(page.elements)) {
          page.elements = [];
        }

        if (!page.template) {
          page.template = "lined";
        }

        if (!page.orientation) {
          page.orientation = "portrait";
        }
      }
    );
  }

  function loadLocal() {
    try {
      const raw =
        localStorage.getItem(
          storageKey()
        );

      if (!raw) {
        return false;
      }

      const parsed =
        JSON.parse(raw);

      if (
        parsed &&
        Array.isArray(parsed.pages)
      ) {
        notebook = parsed;

        ensureNotebook();

        return true;
      }
    } catch (_) {}

    return false;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer =
      setTimeout(
        () => persist(),
        650
      );
  }

  async function persist() {
    if (!mounted || !notebook) {
      return;
    }

    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;

    const version =
      ++saveVersion;

    try {
      notebook.updatedAt =
        Date.now();

      try {
        localStorage.setItem(
          storageKey(),
          JSON.stringify(notebook)
        );
      } catch (_) {}

      /*
       * Supabase persistence is deliberately
       * allowed to happen asynchronously.
       * Nothing in the drawing pipeline waits for it.
       */

      if (
        global.supabase &&
        subject?.id &&
        user?.id
      ) {
        try {
          const payload = {
            user_id: user.id,

            subject_id:
              subject.id,

            content:
              JSON.stringify(notebook),

            updated_at:
              new Date().toISOString(),
          };

          const result =
            await global.supabase
              .from("notebook_pages")
              .upsert(
                payload,
                {
                  onConflict:
                    "user_id,subject_id",
                }
              );

          if (result?.error) {
            /*
             * Local storage remains the fallback.
             */
          }
        } catch (_) {}
      }
    } finally {
      saving = false;

      if (
        saveQueued ||
        version !== saveVersion
      ) {
        saveQueued = false;

        scheduleSave();
      }
    }
  }
  yles
   * ---------------------------------------------------------
   */

  function icon(name) {
    return icons[name] || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    if (!root || !mounted) {
      return;
    }

    ensureNotebook();

    root.innerHTML = `
      <div class="notebook-shell">

        <div class="notebook-head">

          <div class="notebook-title-icon">
            ${icon("pencil")}
          </div>

          <div>
            <p class="eyebrow">
              NOTEBOOK
            </p>

            <h2>
              ${escapeHtml(
                subject?.name ||
                "Notebook"
              )}
            </h2>
          </div>

          <small>
            ${notebook.pages.length}
            ${notebook.pages.length === 1 ? "pagină" : "pagini"}
          </small>

        </div>

        <div class="notebook-toolbar">

          <button
            type="button"
            data-tool="gel"
            class="${tool === "gel" ? "active" : ""}"
            title="Pix"
            aria-label="Pix"
          >
            ${icon("gel")}
          </button>

          <button
            type="button"
            data-tool="ballpoint"
            class="${tool === "ballpoint" ? "active" : ""}"
            title="Pix cu bilă"
            aria-label="Pix cu bilă"
          >
            ${icon("ballpoint")}
          </button>

          <button
            type="button"
            data-tool="pencil"
            class="${tool === "pencil" ? "active" : ""}"
            title="Creion"
            aria-label="Creion"
          >
            ${icon("pencil")}
          </button>

          <button
            type="button"
            data-tool="highlighter"
            class="${tool === "highlighter" ? "active" : ""}"
            title="Marker"
            aria-label="Marker"
          >
            ${icon("highlighter")}
          </button>

          <button
            type="button"
            data-tool="eraser"
            class="${tool === "eraser" ? "active" : ""}"
            title="Radieră"
            aria-label="Radieră"
          >
            ${icon("eraser")}
          </button>

          <div class="notebook-swatches">

            ${palette
              .map(
                (swatch) => `
                  <button
                    type="button"
                    class="${
                      color === swatch
                        ? "notebook-swatch-selected"
                        : ""
                    }"
                    data-color="${swatch}"
                    title="${swatch}"
                    aria-label="Culoare ${swatch}"
                    style="
                      background:${swatch};
                    "
                  ></button>
                `
              )
              .join("")}

          </div>

          <input
            type="color"
            data-color-picker
            value="${color}"
            title="Alege culoarea"
            aria-label="Alege culoarea"
          />

          <div
            class="notebook-width-control"
            data-width-control
          >

            <button
              type="button"
              class="notebook-width-toggle"
              data-width-toggle
              title="Grosime pix"
              aria-label="Grosime pix"
              aria-expanded="false"
            >
              <span
                class="notebook-width-preview"
                data-width-preview
              ></span>
            </button>

            <div
              class="notebook-width-popover"
              data-width-popover
            >

              <div class="notebook-width-label">
                <span>Grosime</span>

                <strong
                  data-width-value
                >
                  ${width}
                </strong>
              </div>

              <input
                data-width
                type="range"
                min="1"
                max="12"
                step=".5"
                value="${width}"
                aria-label="Grosime pix"
              />

              <div
                class="notebook-width-dots"
                aria-hidden="true"
              >
                <i></i>
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>

            </div>

          </div>

          <button
            type="button"
            data-text
            class="${tool === "text" ? "active" : ""}"
            title="Text"
            aria-label="Text"
          >
            ${icon("text")}
          </button>

          <button
            type="button"
            data-shapes
            class="${
              autoShapes
                ? "active"
                : ""
            }"
            title="Forme automate"
            aria-label="Forme automate"
          >
            ${icon("shapes")}
          </button>

          <button
            type="button"
            data-image
            title="Imagine"
            aria-label="Imagine"
          >
            ${icon("image")}
          </button>

          <button
            type="button"
            data-undo
            title="Înapoi"
            aria-label="Înapoi"
          >
            ${icon("undo")}
          </button>

          <button
            type="button"
            data-redo
            title="Refă"
            aria-label="Refă"
          >
            ${icon("redo")}
          </button>

          <button
            type="button"
            data-zoom-out
            title="Micșorează"
            aria-label="Micșorează"
          >
            ${icon("zoomOut")}
          </button>

          <span
            class="notebook-zoom"
            data-zoom-label
          >
            ${Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            data-zoom-in
            title="Mărește"
            aria-label="Mărește"
          >
            ${icon("zoomIn")}
          </button>

          <button
            type="button"
            class="notebook-fullscreen-button"
            data-fullscreen
            title="Ecran complet"
            aria-label="Ecran complet"
          >
            ${icon(
              fullscreen
                ? "exitFullscreen"
                : "fullscreen"
            )}
          </button>

        </div>

        <div
          class="notebook-stage"
          data-stage
        >

          <div
            class="notebook-sheet"
            data-sheet
          >

            <canvas
              class="notebook-base-canvas"
              data-canvas
            ></canvas>

            <canvas
              class="notebook-ink-canvas"
              data-ink-canvas
            ></canvas>

          </div>

        </div>

        <div
          class="notebook-page-controls"
        >

          <button
            type="button"
            data-prev-page
            aria-label="Pagina anterioară"
            title="Pagina anterioară"
          >
            ‹
          </button>

          <span
            class="notebook-page-label"
            data-page-label
          >
            Pagina ${activePage + 1}
            / ${notebook.pages.length}
          </span>

          <button
            type="button"
            data-next-page
            aria-label="Pagina următoare"
            title="Pagina următoare"
          >
            ›
          </button>

          <button
            type="button"
            data-add-page
            aria-label="Adaugă pagină"
            title="Adaugă pagină"
          >
            +
          </button>

        </div>

      </div>
    `;

    canvas =
      root.querySelector(
        "[data-canvas]"
      );

    ctx =
      canvas?.getContext("2d");

    inkCanvas =
      root.querySelector(
        "[data-ink-canvas]"
      );

    inkCtx =
      inkCanvas?.getContext("2d");

    setupCanvas();

    bindToolbar();

    bindCanvas();

    renderCanvas();

    updateTransform();

    updateWidthUi();
  }

  /*
   * ---------------------------------------------------------
   * CANVAS
   * ---------------------------------------------------------
   */

  function setupCanvas() {
    if (
      !canvas ||
      !inkCanvas
    ) {
      return;
    }

    const sheet =
      root.querySelector(
        "[data-sheet]"
      );

    if (!sheet) {
      return;
    }

    const size =
      pageSize();

    const page =
      currentPage();

    const landscape =
      page?.orientation ===
      "landscape";

    const logicalWidth =
      landscape
        ? size.height
        : size.width;

    const logicalHeight =
      landscape
        ? size.width
        : size.height;

    sheet.style.width =
      logicalWidth + "px";

    sheet.style.height =
      logicalHeight + "px";

    const rect =
      sheet.getBoundingClientRect();

    const dpr =
      Math.min(
        global.devicePixelRatio || 1,
        2
      );

    const widthPx =
      Math.max(
        1,
        Math.round(
          rect.width * dpr
        )
      );

    const heightPx =
      Math.max(
        1,
        Math.round(
          rect.height * dpr
        )
      );

    if (
      canvas.width !== widthPx ||
      canvas.height !== heightPx
    ) {
      canvas.width = widthPx;
      canvas.height = heightPx;
    }

    if (
      inkCanvas.width !== widthPx ||
      inkCanvas.height !== heightPx
    ) {
      inkCanvas.width = widthPx;
      inkCanvas.height = heightPx;
    }

    canvas.style.width =
      rect.width + "px";

    canvas.style.height =
      rect.height + "px";

    inkCanvas.style.width =
      rect.width + "px";

    inkCanvas.style.height =
      rect.height + "px";

    if (ctx) {
      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );
    }

    if (inkCtx) {
      inkCtx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );
    }
  }

  function clearInk() {
    if (!inkCtx || !inkCanvas) {
      return;
    }

    inkCtx.clearRect(
      0,
      0,
      inkCanvas.width,
      inkCanvas.height
    );
  }

  /*
   * ---------------------------------------------------------
   * PAGE BACKGROUND
   * ---------------------------------------------------------
   */

  function drawPageBackground() {
    if (!ctx || !canvas) {
      return;
    }

    const page =
      currentPage();

    if (!page) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    ctx.save();

    ctx.clearRect(
      0,
      0,
      w,
      h
    );

    ctx.fillStyle =
      "#ffffff";

    ctx.fillRect(
      0,
      0,
      w,
      h
    );

    if (
      page.template ===
      "lined"
    ) {
      drawLinedBackground(
        w,
        h
      );
    }

    if (
      page.template ===
      "grid"
    ) {
      drawGridBackground(
        w,
        h
      );
    }

    ctx.restore();
  }

  function drawLinedBackground(
    w,
    h
  ) {
    const spacing =
      Math.max(
        24,
        h / 38
      );

    ctx.save();

    ctx.strokeStyle =
      "rgba(140, 140, 150, .16)";

    ctx.lineWidth = 1;

    for (
      let y = spacing;
      y < h;
      y += spacing
    ) {
      ctx.beginPath();

      ctx.moveTo(
        0,
        y
      );

      ctx.lineTo(
        w,
        y
      );

      ctx.stroke();
    }

    ctx.strokeStyle =
      "rgba(245, 150, 175, .20)";

    ctx.beginPath();

    ctx.moveTo(
      w * .105,
      0
    );

    ctx.lineTo(
      w * .105,
      h
    );

    ctx.stroke();

    ctx.restore();
  }

  function drawGridBackground(
    w,
    h
  ) {
    const spacing =
      Math.max(
        22,
        h / 42
      );

    ctx.save();

    ctx.strokeStyle =
      "rgba(140, 140, 150, .13)";

    ctx.lineWidth = 1;

    for (
      let x = 0;
      x < w;
      x += spacing
    ) {
      ctx.beginPath();

      ctx.moveTo(
        x,
        0
      );

      ctx.lineTo(
        x,
        h
      );

      ctx.stroke();
    }

    for (
      let y = 0;
      y < h;
      y += spacing
    ) {
      ctx.beginPath();

      ctx.moveTo(
        0,
        y
      );

      ctx.lineTo(
        w,
        y
      );

      ctx.stroke();
    }

    ctx.restore();
  }

  /*
   * ---------------------------------------------------------
   * STROKES
   * ---------------------------------------------------------
   */

  function drawStroke(
    targetCtx,
    stroke,
    dpr = 1
  ) {
    if (
      !targetCtx ||
      !stroke ||
      !stroke.points?.length
    ) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    const points =
      stroke.points;

    targetCtx.save();

    targetCtx.globalAlpha =
      stroke.tool === "highlighter"
        ? .24
        : stroke.tool === "pencil"
        ? .72
        : 1;

    targetCtx.strokeStyle =
      stroke.color ||
      color;

    targetCtx.lineCap =
      "round";

    targetCtx.lineJoin =
      "round";

    /*
     * A single point must still
     * produce a visible dot.
     *
     * This is important for:
     * - dots above i
     * - periods
     * - tiny Pencil taps
     */
    if (
      points.length === 1
    ) {
      const p =
        points[0];

      const pressure =
        Number(p[2]) || 1;

      targetCtx.fillStyle =
        stroke.color ||
        color;

      const radius =
        Math.max(
          .75,
          stroke.width *
            pressure *
            .5
        ) * dpr;

      targetCtx.beginPath();

      targetCtx.arc(
        p[0] * w * dpr,
        p[1] * h * dpr,
        radius,
        0,
        Math.PI * 2
      );

      targetCtx.fill();

      targetCtx.restore();

      return;
    }

    for (
      let i = 1;
      i < points.length;
      i++
    ) {
      const a =
        points[i - 1];

      const b =
        points[i];

      const next =
        points[i + 1];

      const pressure =
        (
          (Number(a[2]) || 1) +
          (Number(b[2]) || 1)
        ) / 2;

      targetCtx.lineWidth =
        Math.max(
          .75,
          stroke.width *
            pressure
        ) * dpr;

      targetCtx.beginPath();

      targetCtx.moveTo(
        a[0] * w * dpr,
        a[1] * h * dpr
      );

      /*
       * Light causal smoothing.
       *
       * It smooths Pencil jitter
       * without waiting for future
       * samples and without turning
       * letters into geometric shapes.
       */
      if (next) {
        targetCtx.quadraticCurveTo(
          b[0] * w * dpr,
          b[1] * h * dpr,
          (
            (b[0] + next[0]) *
            w *
            dpr
          ) / 2,
          (
            (b[1] + next[1]) *
            h *
            dpr
          ) / 2
        );
      } else {
        targetCtx.lineTo(
          b[0] * w * dpr,
          b[1] * h * dpr
        );
      }

      targetCtx.stroke();
    }

    targetCtx.restore();
  }

  function renderStrokes() {
    if (!ctx) {
      return;
    }

    const page =
      currentPage();

    if (!page) {
      return;
    }

    const dpr =
      Math.min(
        global.devicePixelRatio || 1,
        2
      );

    for (
      const stroke of
      page.strokes || []
    ) {
      drawStroke(
        ctx,
        stroke,
        dpr
      );
    }
  }

  function renderElements() {
    const page =
      currentPage();

    if (
      !ctx ||
      !page
    ) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    for (
      const element of
      page.elements || []
    ) {
      if (
        element.kind ===
        "text"
      ) {
        drawTextElement(
          element,
          w,
          h
        );
      }

      if (
        element.kind ===
        "shape"
      ) {
        drawShapeElement(
          element,
          w,
          h
        );
      }

      if (
        element.kind ===
        "image"
      ) {
        drawImageElement(
          element,
          w,
          h
        );
      }
    }
  }

  function renderCanvas() {
    if (!ctx || !canvas) {
      return;
    }

    setupCanvas();

    drawPageBackground();

    renderElements();

    renderStrokes();

    clearInk();

    updatePageLabel();
  }

  /*
   * ---------------------------------------------------------
   * TEXT
   * ---------------------------------------------------------
   */

  function drawTextElement(
    element,
    w,
    h
  ) {
    if (!element.text) {
      return;
    }

    ctx.save();

    ctx.fillStyle =
      element.color ||
      color;

    ctx.font =
      `${element.size || 22}px ` +
      `system-ui, -apple-system, ` +
      `BlinkMacSystemFont, sans-serif`;

    ctx.textBaseline =
      "top";

    ctx.fillText(
      element.text,
      element.x * w,
      element.y * h
    );

    ctx.restore();
  }

  /*
   * ---------------------------------------------------------
   * SHAPES
   * ---------------------------------------------------------
   */

  function drawShapeElement(
    element,
    w,
    h
  ) {
    const x =
      element.x * w;

    const y =
      element.y * h;

    const width =
      element.width * w;

    const height =
      element.height * h;

    ctx.save();

    ctx.strokeStyle =
      element.color ||
      color;

    ctx.lineWidth =
      element.lineWidth ||
      width;

    ctx.lineCap =
      "round";

    ctx.lineJoin =
      "round";

    ctx.beginPath();

    if (
      element.shape ===
      "line"
    ) {
      ctx.moveTo(
        x,
        y
      );

      ctx.lineTo(
        x + width,
        y + height
      );
    }

    if (
      element.shape ===
      "arrow"
    ) {
      drawArrow(
        ctx,
        x,
        y,
        x + width,
        y + height
      );
    }

    if (
      element.shape ===
      "rectangle"
    ) {
      ctx.rect(
        x,
        y,
        width,
        height
      );
    }

    if (
      element.shape ===
      "ellipse"
    ) {
      ctx.ellipse(
        x + width / 2,
        y + height / 2,
        Math.abs(width / 2),
        Math.abs(height / 2),
        0,
        0,
        Math.PI * 2
      );
    }

    if (
      element.shape ===
      "triangle"
    ) {
      ctx.moveTo(
        x + width / 2,
        y
      );

      ctx.lineTo(
        x + width,
        y + height
      );

      ctx.lineTo(
        x,
        y + height
      );

      ctx.closePath();
    }

    ctx.stroke();

    ctx.restore();
  }

  function drawArrow(
    targetCtx,
    x1,
    y1,
    x2,
    y2
  ) {
    const angle =
      Math.atan2(
        y2 - y1,
        x2 - x1
      );

    const head =
      12;

    targetCtx.moveTo(
      x1,
      y1
    );

    targetCtx.lineTo(
      x2,
      y2
    );

    targetCtx.moveTo(
      x2,
      y2
    );

    targetCtx.lineTo(
      x2 -
        head *
        Math.cos(
          angle - Math.PI / 6
        ),
      y2 -
        head *
        Math.sin(
          angle - Math.PI / 6
        )
    );

    targetCtx.moveTo(
      x2,
      y2
    );

    targetCtx.lineTo(
      x2 -
        head *
        Math.cos(
          angle + Math.PI / 6
        ),
      y2 -
        head *
        Math.sin(
          angle + Math.PI / 6
        )
    );
  }

  /*
   * ---------------------------------------------------------
   * IMAGES
   * ---------------------------------------------------------
   */

  function drawImageElement(
    element,
    w,
    h
  ) {
    if (!element.src) {
      return;
    }

    let image =
      imageCache.get(
        element.src
      );

    if (!image) {
      image =
        new Image();

      image.onload =
        () => {
          imageCache.set(
            element.src,
            image
          );

          renderCanvas();
        };

      image.src =
        element.src;

      imageCache.set(
        element.src,
        image
      );

      return;
    }

    if (!image.complete) {
      return;
    }

    ctx.drawImage(
      image,
      element.x * w,
      element.y * h,
      element.width * w,
      element.height * h
    );
  } 
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

          <select
            data-template
            title="Fundal"
            aria-label="Fundal"
          >
            ${Object.entries(
              templates
            )
              .map(
                ([value, label]) => `
                  <option
                    value="${value}"
                    ${
                      page.template === value
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
            title="Orientare"
            aria-label="Orientare"
          >
            <option
              value="portrait"
              ${
                page.orientation ===
                "portrait"
                  ? "selected"
                  : ""
              }
            >
              Portret
            </option>

            <option
              value="landscape"
              ${
                page.orientation ===
                "landscape"
                  ? "selected"
                  : ""
              }
            >
              Landscape
            </option>
          </select>

      <div

  class="notebook-width-control"

  data-width-control

>

  <button

    type="button"

    class="notebook-width-toggle"

    data-width-toggle

    title="Grosime pix"

    aria-label="Grosime pix"

    aria-expanded="false"

  >

    <span

      class="notebook-width-preview"

      data-width-preview

    ></span>

  </button>

  <div

    class="notebook-width-popover"

    data-width-popover

  >

    <div class="notebook-width-label">

      <span>Grosime</span>

      <strong data-width-value>${width}</strong>

    </div>

    <input

      data-width

      type="range"

      min="1"

      max="12"

      step=".5"

      value="${width}"

      aria-label="Grosime pix"

    />

    <div

      class="notebook-width-dots"

      aria-hidden="true"

    >

      <i></i>

      <i></i>

      <i></i>

      <i></i>

      <i></i>

    </div>

  </div>

</div>

          <input
            data-color
            type="color"
            value="${color}"
            title="Culoare"
            aria-label="Culoare"
          />

          <div
            class="notebook-swatches"
            data-swatches
          >
            ${palette
              .map(
                (swatch) => `
                  <button
                    type="button"
                    data-swatch="${swatch}"
                    title="${swatch}"
                    aria-label="Culoare ${swatch}"
                    class="${
                      color === swatch
                        ? "notebook-swatch-selected"
                        : ""
                    }"
                    style="
                      background:${swatch};
                    "
                  ></button>
                `
              )
              .join("")}
          </div>

          <button
            data-fullscreen
            class="notebook-fullscreen-button"
            title="${
              fullscreen
                ? "Ieșire din ecran complet"
                : "Ecran complet"
            }"
            aria-label="${
              fullscreen
                ? "Ieșire din ecran complet"
                : "Ecran complet"
            }"
          >
            ${
              fullscreen
                ? icons.exitFullscreen
                : icons.fullscreen
            }
          </button>

        </div>

        <div
          class="notebook-stage"
          data-stage
        >

          <div
            class="notebook-sheet"
            data-sheet
          >

            <canvas
              class="notebook-base-canvas"
              data-canvas
            ></canvas>

            <canvas
              class="notebook-ink-canvas"
              data-ink-canvas
            ></canvas>

          </div>

        </div>

        <div
          class="notebook-page-controls"
        >

          <button
            type="button"
            data-prev-page
            title="Pagina anterioară"
            aria-label="Pagina anterioară"
          >
            ‹
          </button>

          <span
            data-page-label
          >
            Pagina
            ${activePage + 1}
            /
            ${notebook.pages.length}
          </span>

          <button
            type="button"
            data-next-page
            title="Pagina următoare"
            aria-label="Pagina următoare"
          >
            ›
          </button>

          <button
            type="button"
            data-add-page
            title="Pagină nouă"
            aria-label="Pagină nouă"
          >
            +
          </button>

        </div>

        <div
          class="notebook-page-strip"
          data-page-strip
        >
          ${notebook.pages
            .map(
              (_, index) => `
                <button
                  type="button"
                  class="notebook-page-thumb ${
                    index === activePage
                      ? "active"
                      : ""
                  }"
                  data-page="${index}"
                  aria-label="Pagina ${
                    index + 1
                  }"
                >
                  <canvas></canvas>
                </button>
              `
            )
            .join("")}
        </div>

      </section>
    `;

    canvas =
      root.querySelector(
        "[data-canvas]"
      );

    inkCanvas =
      root.querySelector(
        "[data-ink-canvas]"
      );

    ctx =
      canvas?.getContext(
        "2d"
      );

    inkCtx =
      inkCanvas?.getContext(
        "2d"
      );

    setupCanvas();

    bindToolbar();

    bindCanvas();

    renderCanvas();

    renderPageThumbs();

    updateTransform();

    updateZoomLabel();

    updateWidthUi();
  }

  /*
   * ---------------------------------------------------------
   * TOOL BUTTON
   * ---------------------------------------------------------
   */

  function toolButton(
    name,
    svg,
    label
  ) {
    return `
      <button
        type="button"
        data-tool="${name}"
        class="${
          tool === name
            ? "active"
            : ""
        }"
        title="${label}"
        aria-label="${label}"
      >
        ${svg}
      </button>
    `;
  }

  /*
   * ---------------------------------------------------------
   * TOOLBAR
   * ---------------------------------------------------------
   */

  function bindToolbar() {
    if (!root) {
      return;
    }

    root
      .querySelectorAll(
        "[data-tool]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              const nextTool =
                button.dataset.tool;

              tool =
                nextTool;

              shapeTool = "";

              updateToolbar();

              wakeToolbar();
            }
          );
        }
      );

    root
      .querySelectorAll(
        "[data-swatch]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              color =
                button.dataset.swatch;

              updateToolbar();

              wakeToolbar();
            }
          );
        }
      );

    const colorInput =
      root.querySelector(
        "[data-color]"
      );

    colorInput?.addEventListener(
      "input",
      (event) => {
        color =
          event.target.value;

        updateToolbar();
      }
    );

    const widthInput =
      root.querySelector(
        "[data-width]"
      );

    widthInput?.addEventListener(
      "input",
      (event) => {
        width =
          Number(
            event.target.value
          ) || 3;

        updateWidthUi();

        wakeToolbar();
      }
    );

    root
      .querySelector(
        "[data-auto-shapes]"
      )
      ?.addEventListener(
        "click",
        () => {
          autoShapes =
            !autoShapes;

          updateToolbar();

          wakeToolbar();
        }
      );

    root
      .querySelector(
        "[data-undo]"
      )
      ?.addEventListener(
        "click",
        undo
      );

    root
      .querySelector(
        "[data-redo]"
      )
      ?.addEventListener(
        "click",
        redoAction
      );

    root
      .querySelector(
        "[data-zoom-in]"
      )
      ?.addEventListener(
        "click",
        () => {
          setZoom(
            zoom + .1
          );
        }
      );

    root
      .querySelector(
        "[data-zoom-out]"
      )
      ?.addEventListener(
        "click",
        () => {
          setZoom(
            zoom - .1
          );
        }
      );

    root
      .querySelector(
        "[data-template]"
      )
      ?.addEventListener(
        "change",
        (event) => {
          const page =
            currentPage();

          if (!page) {
            return;
          }

          page.template =
            event.target.value;

          renderCanvas();

          localSave();
        }
      );

    root
      .querySelector(
        "[data-orientation]"
      )
      ?.addEventListener(
        "change",
        (event) => {
          const page =
            currentPage();

          if (!page) {
            return;
          }

          page.orientation =
            event.target.value;

          render();

          localSave();
        }
      );

    root
      .querySelector(
        "[data-fullscreen]"
      )
      ?.addEventListener(
        "click",
        toggleFullscreen
      );

    root
      .querySelector(
        "[data-add-image]"
      )
      ?.addEventListener(
        "click",
        addImage
      );

    root
      .querySelector(
        "[data-prev-page]"
      )
      ?.addEventListener(
        "click",
        previousPage
      );

    root
      .querySelector(
        "[data-next-page]"
      )
      ?.addEventListener(
        "click",
        nextPage
      );

    root
      .querySelector(
        "[data-add-page]"
      )
      ?.addEventListener(
        "click",
        addPage
      );

    root
      .querySelector(
        "[data-page-strip]"
      )
      ?.querySelectorAll(
        "[data-page]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              activePage =
                Number(
                  button.dataset.page
                );

              notebook.activePage =
                activePage;

              render();

              localSave();
            }
          );
        }
      );

    /*
     * Width control for fullscreen.
     */

    const widthControl =
      root.querySelector(
        "[data-width-control]"
      );

    const widthToggle =
      root.querySelector(
        "[data-width-toggle]"
      );

    const widthPopover =
      root.querySelector(
        "[data-width-popover]"
      );

    const widthValue =
      root.querySelector(
        "[data-width-value]"
      );

    const widthPreview =
      root.querySelector(
        "[data-width-preview]"
      );

    if (
      widthControl &&
      widthToggle
    ) {
      widthToggle.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          const open =
            widthControl.classList.toggle(
              "open"
            );

          widthToggle.setAttribute(
            "aria-expanded",
            String(open)
          );

          updateWidthUi();
        }
      );

      widthPopover?.addEventListener(
        "pointerdown",
        (event) => {
          event.stopPropagation();
        }
      );

      root.addEventListener(
        "pointerdown",
        (event) => {
          if (
            !widthControl.contains(
              event.target
            )
          ) {
            widthControl.classList.remove(
              "open"
            );

            widthToggle.setAttribute(
              "aria-expanded",
              "false"
            );
          }
        },
        {
          passive: true,
        }
      );
    }

    function updateWidthUi() {
      if (widthValue) {
        widthValue.textContent =
          String(width);
      }

      if (widthPreview) {
        const size =
          Math.max(
            4,
            Math.min(
              20,
              3 +
                width *
                  .85
            )
          );

        widthPreview.style.width =
          size + "px";

        widthPreview.style.height =
          size + "px";
      }
    }

    /*
     * Keep the original range
     * in sync too.
     */

    updateWidthUi();
  }

  function updateToolbar() {
    if (!root) {
      return;
    }

    root
      .querySelectorAll(
        "[data-tool]"
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            "active",
            button.dataset.tool ===
              tool
          );
        }
      );

    const autoShapeButton =
      root.querySelector(
        "[data-auto-shapes]"
      );

    if (autoShapeButton) {
      autoShapeButton.classList.toggle(
        "active",
        autoShapes
      );

      autoShapeButton.setAttribute(
        "aria-pressed",
        String(autoShapes)
      );
    }

    root
      .querySelectorAll(
        "[data-swatch]"
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            "notebook-swatch-selected",
            button.dataset.swatch ===
              color
          );
        }
      );

    const colorInput =
      root.querySelector(
        "[data-color]"
      );

    if (
      colorInput &&
      colorInput.value !== color
    ) {
      colorInput.value =
        color;
    }

    updateWidthUi();
  }

  function updateWidthUi() {
    const widthInput =
      root?.querySelector(
        "[data-width]"
      );

    if (widthInput) {
      widthInput.value =
        String(width);
    }

    const widthValue =
      root?.querySelector(
        "[data-width-value]"
      );

    if (widthValue) {
      widthValue.textContent =
        String(width);
    }

    const widthPreview =
      root?.querySelector(
        "[data-width-preview]"
      );

    if (widthPreview) {
      const size =
        Math.max(
          4,
          Math.min(
            20,
            3 +
              width *
                .85
          )
        );

      widthPreview.style.width =
        size + "px";

      widthPreview.style.height =
        size + "px";
    }
  }
    /*
   * ---------------------------------------------------------
   * PAGE HELPERS
   * ---------------------------------------------------------
   */

  function currentPage() {
    if (!notebook || !Array.isArray(notebook.pages)) {
      return null;
    }

    return notebook.pages[activePage] || notebook.pages[0];
  }

  function storageKey() {
    return (
      "itera-notebook-" +
      String(subject?.id || "unknown")
    );
  }

  function cloneNotebook(value) {
    try {
      return JSON.parse(
        JSON.stringify(value)
      );
    } catch (_) {
      return null;
    }
  }

  function normalizeNotebook() {
    if (!notebook || typeof notebook !== "object") {
      notebook = freshNotebook();
      return;
    }

    if (!Array.isArray(notebook.pages) || !notebook.pages.length) {
      notebook.pages = freshNotebook().pages;
    }

    notebook.pages.forEach((page) => {
      if (!page || typeof page !== "object") {
        return;
      }

      if (!templates[page.template]) {
        page.template = "lined";
      }

      if (
        page.orientation !== "landscape" &&
        page.orientation !== "portrait"
      ) {
        page.orientation = "portrait";
      }

      if (
        typeof page.background !== "string" ||
        !page.background
      ) {
        page.background = "#fffdf9";
      }

      if (!Array.isArray(page.strokes)) {
        page.strokes = [];
      }

      if (!Array.isArray(page.elements)) {
        page.elements = [];
      }

      page.strokes = page.strokes.filter(
        (stroke) =>
          stroke &&
          Array.isArray(stroke.points) &&
          stroke.points.length
      );

      page.elements = page.elements.filter(
        Boolean
      );
    });
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(
        storageKey()
      );

      if (!raw) {
        return freshNotebook();
      }

      const parsed = JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !== "object"
      ) {
        return freshNotebook();
      }

      return parsed;
    } catch (_) {
      return freshNotebook();
    }
  }

  /*
   * ---------------------------------------------------------
   * CLOUD LOADING
   * ---------------------------------------------------------
   */

  async function loadCloud() {
    if (!mounted || !user || !subject?.id) {
      return;
    }

    try {
      const {
        data,
        error,
      } = await supabaseClient
        .from("notebooks")
        .select("*")
        .eq("user_id", user.id)
        .eq("subject_id", subject.id)
        .maybeSingle();

      if (!mounted || error || !data) {
        return;
      }

      const remoteNotebook =
        data.notebook ||
        data.content ||
        data.data;

      if (
        !remoteNotebook ||
        typeof remoteNotebook !== "object"
      ) {
        return;
      }

      /*
       * Local edits may have happened while
       * the cloud request was in flight.
       *
       * Only replace the local notebook when
       * the remote copy is newer.
       */
      const remoteUpdatedAt =
        Number(
          data.updated_at ||
            remoteNotebook.updatedAt ||
            0
        );

      const localUpdatedAt =
        Number(
          notebook?.updatedAt ||
            0
        );

      if (
        remoteUpdatedAt &&
        localUpdatedAt &&
        localUpdatedAt > remoteUpdatedAt
      ) {
        return;
      }

      notebook =
        cloneNotebook(
          remoteNotebook
        ) ||
        freshNotebook();

      normalizeNotebook();

      activePage = Math.min(
        activePage,
        notebook.pages.length - 1
      );

      redo = [];

      render();

      try {
        localStorage.setItem(
          storageKey(),
          JSON.stringify(notebook)
        );
      } catch (_) {}
    } catch (_) {
      /*
       * Local notebook remains usable even
       * when cloud loading fails.
       */
    }
  }

  /*
   * ---------------------------------------------------------
   * LOCAL + CLOUD SAVE
   * ---------------------------------------------------------
   */

  function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      if (
        drawing ||
        pointers.size
      ) {
        scheduleSave();
        return;
      }

      void persist();
    }, 1200);
  }

  function localSave() {
    /*
     * Do not serialize the entire notebook while
     * Apple Pencil is drawing.
     *
     * The previous synchronous localStorage write
     * could briefly freeze Safari/iPadOS exactly
     * when a stroke ended.
     */
    scheduleSave();

    clearTimeout(localCacheTimer);

    const flush = () => {
      if (
        !mounted ||
        drawing ||
        pointers.size
      ) {
        localCacheTimer =
          setTimeout(
            flush,
            220
          );

        return;
      }

      try {
        notebook.updatedAt =
          Date.now();

        localStorage.setItem(
          storageKey(),
          JSON.stringify(
            notebook
          )
        );
      } catch (_) {}
    };

    localCacheTimer =
      setTimeout(
        flush,
        900
      );
  }

  async function persist() {
    if (
      !mounted ||
      !user ||
      !subject?.id ||
      !notebook
    ) {
      return;
    }

    /*
     * Never start a cloud serialization/upload
     * while the pencil is actively producing
     * samples.
     */
    if (
      drawing ||
      pointers.size
    ) {
      scheduleSave();
      return;
    }

    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    saveQueued = false;

    const version =
      ++saveVersion;

    const snapshot =
      cloneNotebook(
        notebook
      );

    if (!snapshot) {
      saving = false;
      return;
    }

    snapshot.updatedAt =
      Date.now();

    try {
      const {
        error,
      } = await supabaseClient
        .from("notebooks")
        .upsert(
          {
            user_id:
              user.id,

            subject_id:
              subject.id,

            notebook:
              snapshot,

            updated_at:
              new Date(
                snapshot.updatedAt
              ).toISOString(),
          },
          {
            onConflict:
              "user_id,subject_id",
          }
        );

      if (
        error
      ) {
        throw error;
      }

      /*
       * If another save was scheduled while
       * this upload was running, let it run
       * after the current request finishes.
       */
      if (
        version !==
        saveVersion
      ) {
        saveQueued = true;
      }
    } catch (_) {
      /*
       * The local copy is still available.
       * Retry through the normal save queue.
       */
    } finally {
      saving = false;

      if (
        saveQueued ||
        version !== saveVersion
      ) {
        saveQueued = false;
        scheduleSave();
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * CANVAS SIZE / GEOMETRY
   * ---------------------------------------------------------
   */

  function pageAspectRatio() {
    const page =
      currentPage();

    if (
      page?.orientation ===
      "landscape"
    ) {
      return 297 / 210;
    }

    return 210 / 297;
  }

  function resizeCanvas() {
    if (
      !canvas ||
      !inkCanvas ||
      !ctx ||
      !inkCtx
    ) {
      return;
    }

    const sheet =
      root?.querySelector(
        "[data-notebook-sheet]"
      );

    if (!sheet) {
      return;
    }

    const widthPx =
      Math.max(
        1,
        Math.round(
          sheet.clientWidth
        )
      );

    const heightPx =
      Math.max(
        1,
        Math.round(
          sheet.clientHeight
        )
      );

    const dpr =
      Math.min(
        global.devicePixelRatio || 1,
        2
      );

    const pixelWidth =
      Math.max(
        1,
        Math.round(
          widthPx * dpr
        )
      );

    const pixelHeight =
      Math.max(
        1,
        Math.round(
          heightPx * dpr
        )
      );

    if (
      canvas.width !==
        pixelWidth ||
      canvas.height !==
        pixelHeight
    ) {
      canvas.width =
        pixelWidth;

      canvas.height =
        pixelHeight;
    }

    if (
      inkCanvas.width !==
        pixelWidth ||
      inkCanvas.height !==
        pixelHeight
    ) {
      inkCanvas.width =
        pixelWidth;

      inkCanvas.height =
        pixelHeight;
    }

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    inkCtx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    renderCanvas();
  }

  function clearInk() {
    if (
      !inkCtx ||
      !inkCanvas
    ) {
      return;
    }

    inkCtx.clearRect(
      0,
      0,
      inkCanvas.width,
      inkCanvas.height
    );
  }

  function clearCanvas() {
    if (
      !ctx ||
      !canvas
    ) {
      return;
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  /*
   * ---------------------------------------------------------
   * PAGE BACKGROUND
   * ---------------------------------------------------------
   */

  function drawPageBackground() {
    const page =
      currentPage();

    if (
      !ctx ||
      !canvas ||
      !page
    ) {
      return;
    }

    const widthPx =
      canvas.clientWidth;

    const heightPx =
      canvas.clientHeight;

    ctx.save();

    ctx.fillStyle =
      page.background ||
      "#fffdf9";

    ctx.fillRect(
      0,
      0,
      widthPx,
      heightPx
    );

    ctx.restore();
  }

  function drawTemplate() {
    const page =
      currentPage();

    if (
      !ctx ||
      !canvas ||
      !page
    ) {
      return;
    }

    const widthPx =
      canvas.clientWidth;

    const heightPx =
      canvas.clientHeight;

    ctx.save();

    if (
      page.template ===
      "lined"
    ) {
      const spacing =
        Math.max(
          20,
          Math.min(
            34,
            widthPx / 27
          )
        );

      ctx.strokeStyle =
        "rgba(120,120,120,.18)";

      ctx.lineWidth =
        1;

      for (
        let y = spacing;
        y < heightPx;
        y += spacing
      ) {
        ctx.beginPath();

        ctx.moveTo(
          0,
          y
        );

        ctx.lineTo(
          widthPx,
          y
        );

        ctx.stroke();
      }
    }

    if (
      page.template ===
      "grid"
    ) {
      const spacing =
        Math.max(
          18,
          Math.min(
            30,
            widthPx / 30
          )
        );

      ctx.strokeStyle =
        "rgba(120,120,120,.14)";

      ctx.lineWidth =
        1;

      for (
        let x = 0;
        x < widthPx;
        x += spacing
      ) {
        ctx.beginPath();

        ctx.moveTo(
          x,
          0
        );

        ctx.lineTo(
          x,
          heightPx
        );

        ctx.stroke();
      }

      for (
        let y = 0;
        y < heightPx;
        y += spacing
      ) {
        ctx.beginPath();

        ctx.moveTo(
          0,
          y
        );

        ctx.lineTo(
          widthPx,
          y
        );

        ctx.stroke();
      }
    }

    ctx.restore();
  }
    /*
   * ---------------------------------------------------------
   * STROKE RENDERING
   * ---------------------------------------------------------
   */

  function drawStroke(
    targetCtx,
    stroke,
    dpr = 1
  ) {
    if (
      !targetCtx ||
      !stroke ||
      !Array.isArray(stroke.points) ||
      !stroke.points.length
    ) {
      return;
    }

    const points =
      stroke.points;

    const widthPx =
      canvas.clientWidth;

    const heightPx =
      canvas.clientHeight;

    targetCtx.save();

    const alpha =
      stroke.tool ===
      "highlighter"
        ? 0.24
        : stroke.tool ===
          "pencil"
          ? 0.72
          : 1;

    targetCtx.globalAlpha =
      alpha;

    targetCtx.strokeStyle =
      stroke.color ||
      color;

    targetCtx.fillStyle =
      stroke.color ||
      color;

    targetCtx.lineCap =
      "round";

    targetCtx.lineJoin =
      "round";

    /*
     * A single Apple Pencil tap is a real
     * dot, not an empty stroke.
     */
    if (
      points.length === 1
    ) {
      const point =
        points[0];

      const pressure =
        Number(point[2]) || 1;

      const radius =
        Math.max(
          0.7,
          (
            Math.max(
              0.75,
              Number(
                stroke.width
              ) || 1
            ) *
            pressure
          ) *
            0.48
        ) *
        dpr;

      targetCtx.beginPath();

      targetCtx.arc(
        point[0] *
          widthPx *
          dpr,

        point[1] *
          heightPx *
          dpr,

        radius,

        0,
        Math.PI * 2
      );

      targetCtx.fill();

      targetCtx.restore();

      return;
    }

    targetCtx.lineWidth =
      Math.max(
        0.75,
        (
          Number(
            stroke.width
          ) || 1
        ) *
          (
            Number(
              points[0][2]
            ) || 1
          )
      ) *
        dpr;

    targetCtx.beginPath();

    const first =
      points[0];

    targetCtx.moveTo(
      first[0] *
        widthPx *
        dpr,

      first[1] *
        heightPx *
        dpr
    );

    /*
     * Light causal smoothing.
     *
     * We only look one point ahead,
     * so handwriting does not feel
     * like it is following the Pencil
     * with a visible delay.
     */
    for (
      let i = 1;
      i < points.length;
      i++
    ) {
      const previous =
        points[i - 1];

      const current =
        points[i];

      const pressure =
        (
          Number(
            previous[2]
          ) || 1
        ) +
        (
          Number(
            current[2]
          ) || 1
        );

      const averagedPressure =
        pressure / 2;

      targetCtx.lineWidth =
        Math.max(
          0.75,
          (
            Number(
              stroke.width
            ) || 1
          ) *
            averagedPressure
        ) *
          dpr;

      const px =
        previous[0] *
        widthPx *
        dpr;

      const py =
        previous[1] *
        heightPx *
        dpr;

      const cx =
        current[0] *
        widthPx *
        dpr;

      const cy =
        current[1] *
        heightPx *
        dpr;

      /*
       * A midpoint keeps the curve soft
       * without introducing future-looking
       * interpolation.
       */
      const midX =
        (
          px + cx
        ) / 2;

      const midY =
        (
          py + cy
        ) / 2;

      targetCtx.quadraticCurveTo(
        px,
        py,
        midX,
        midY
      );
    }

    const last =
      points[
        points.length - 1
      ];

    targetCtx.lineTo(
      last[0] *
        widthPx *
        dpr,

      last[1] *
        heightPx *
        dpr
    );

    targetCtx.stroke();

    targetCtx.restore();
  }

  /*
   * ---------------------------------------------------------
   * LIVE PENCIL RENDERING
   * ---------------------------------------------------------
   */

  function liveStrokeWidth(
    stroke,
    pressure
  ) {
    return Math.max(
      0.75,
      (
        Number(
          stroke?.width
        ) || 1
      ) *
        (
          Number(
            pressure
          ) || 1
        )
    );
  }

  function drawLiveDot(
    point
  ) {
    if (
      !inkCtx ||
      !drawing ||
      !point
    ) {
      return;
    }

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
        2
      );

    const widthPx =
      canvas.clientWidth;

    const heightPx =
      canvas.clientHeight;

    const radius =
      Math.max(
        0.9,
        liveStrokeWidth(
          drawing,
          point[2]
        ) *
          0.48
      ) *
      dpr;

    inkCtx.save();

    inkCtx.globalAlpha =
      drawing.tool ===
      "highlighter"
        ? 0.24
        : drawing.tool ===
          "pencil"
          ? 0.72
          : 1;

    inkCtx.fillStyle =
      drawing.color ||
      color;

    inkCtx.beginPath();

    inkCtx.arc(
      point[0] *
        widthPx *
        dpr,

      point[1] *
        heightPx *
        dpr,

      radius,

      0,
      Math.PI * 2
    );

    inkCtx.fill();

    inkCtx.restore();
  }

  function drawLiveSegment(
    previous,
    point
  ) {
    if (
      !inkCtx ||
      !drawing ||
      !previous ||
      !point
    ) {
      return;
    }

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
        2
      );

    const widthPx =
      canvas.clientWidth;

    const heightPx =
      canvas.clientHeight;

    const pressure =
      (
        Number(
          previous[2]
        ) || 1
      ) +
      (
        Number(
          point[2]
        ) || 1
      );

    const averagedPressure =
      pressure / 2;

    inkCtx.save();

    inkCtx.globalAlpha =
      drawing.tool ===
      "highlighter"
        ? 0.24
        : drawing.tool ===
          "pencil"
          ? 0.72
          : 1;

    inkCtx.strokeStyle =
      drawing.color ||
      color;

    inkCtx.lineCap =
      "round";

    inkCtx.lineJoin =
      "round";

    inkCtx.lineWidth =
      liveStrokeWidth(
        drawing,
        averagedPressure
      ) *
      dpr;

    inkCtx.beginPath();

    inkCtx.moveTo(
      previous[0] *
        widthPx *
        dpr,

      previous[1] *
        heightPx *
        dpr
    );

    inkCtx.lineTo(
      point[0] *
        widthPx *
        dpr,

      point[1] *
        heightPx *
        dpr
    );

    inkCtx.stroke();

    inkCtx.restore();
  }

  function drawLive() {
    if (
      !drawing ||
      !inkCtx
    ) {
      return;
    }

    clearInk();

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
        2
      );

    drawStroke(
      inkCtx,
      drawing,
      dpr
    );
  }

  function addSamples(
    events
  ) {
    if (!drawing) {
      return;
    }

    for (
      const event of
        events || []
    ) {
      if (
        !event ||
        !Number.isFinite(
          event.clientX
        ) ||
        !Number.isFinite(
          event.clientY
        )
      ) {
        continue;
      }

      const point =
        pointFromEvent(
          event
        );

      const last =
        drawing.points[
          drawing.points.length - 1
        ];

      /*
       * Do not throw away tiny movements.
       * Apple Pencil handwriting contains many
       * intentionally tiny samples.
       */
      if (
        last &&
        point[0] ===
          last[0] &&
        point[1] ===
          last[1] &&
        point[2] ===
          last[2]
      ) {
        continue;
      }

      drawing.points.push(
        point
      );

      if (!last) {
        drawLiveDot(
          point
        );
      } else {
        drawLiveSegment(
          last,
          point
        );
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * POINT CONVERSION
   * ---------------------------------------------------------
   */

  function pointFromEvent(
    event
  ) {
    const rect =
      inkCanvas.getBoundingClientRect();

    const x =
      (
        event.clientX -
        rect.left
      ) /
      rect.width;

    const y =
      (
        event.clientY -
        rect.top
      ) /
      rect.height;

    let pressure = 1;

    if (
      event.pointerType ===
        "pen" &&
      Number.isFinite(
        event.pressure
      ) &&
      event.pressure > 0
    ) {
      pressure =
        Math.max(
          0.28,
          Math.min(
            1.65,
            event.pressure *
              1.35
          )
        );
    }

    return [
      Math.max(
        0,
        Math.min(
          1,
          x
        )
      ),

      Math.max(
        0,
        Math.min(
          1,
          y
        )
      ),

      pressure,
    ];
  }

  /*
   * ---------------------------------------------------------
   * CONTINUOUS ERASER
   * ---------------------------------------------------------
   */

  function distancePointToSegment(
    px,
    py,
    ax,
    ay,
    bx,
    by
  ) {
    const dx =
      bx - ax;

    const dy =
      by - ay;

    if (
      dx === 0 &&
      dy === 0
    ) {
      return Math.hypot(
        px - ax,
        py - ay
      );
    }

    const t =
      Math.max(
        0,
        Math.min(
          1,
          (
            (
              px - ax
            ) *
              dx +
            (
              py - ay
            ) *
              dy
          ) /
            (
              dx * dx +
              dy * dy
            )
        )
      );

    const closestX =
      ax +
      t * dx;

    const closestY =
      ay +
      t * dy;

    return Math.hypot(
      px - closestX,
      py - closestY
    );
  }

  function eraseAt(
    at
  ) {
    const page =
      currentPage();

    if (
      !page ||
      !Array.isArray(
        page.strokes
      )
    ) {
      return false;
    }

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

    let changed =
      false;

    const nextStrokes =
      [];

    page.strokes.forEach(
      (stroke) => {
        const points =
          stroke.points ||
          [];

        if (
          !points.length
        ) {
          return;
        }

        /*
         * A dot is either kept or erased
         * as a whole.
         */
        if (
          points.length === 1
        ) {
          const point =
            points[0];

          if (
            Math.hypot(
              point[0] -
                at[0],
              point[1] -
                at[1]
            ) <=
            radius
          ) {
            changed = true;
          } else {
            nextStrokes.push(
              stroke
            );
          }

          return;
        }

        let part = [];
        let hit = false;

        const flush =
          () => {
            if (
              part.length
            ) {
              nextStrokes.push({
                ...stroke,
                points: part,
              });
            }

            part = [];
          };

        for (
          let i = 0;
          i < points.length;
          i++
        ) {
          const point =
            points[i];

          const pointHit =
            Math.hypot(
              point[0] -
                at[0],
              point[1] -
                at[1]
            ) <=
            radius;

          const segmentHit =
            i > 0 &&
            distancePointToSegment(
              at[0],
              at[1],

              points[
                i - 1
              ][0],

              points[
                i - 1
              ][1],

              point[0],
              point[1]
            ) <=
            radius;

          if (
            pointHit ||
            segmentHit
          ) {
            flush();

            hit = true;
            changed = true;
          } else {
            part.push(
              point
            );
          }
        }

        flush();

        if (!hit) {
          nextStrokes.push(
            stroke
          );
        }
      }
    );

    if (!changed) {
      return false;
    }

    page.strokes =
      nextStrokes;

    renderCanvas();

    return true;
  }
    function renderCanvas() {
    if (
      !ctx ||
      !canvas
    ) {
      return;
    }

    paintPaper();

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
        2
      );

    const page =
      currentPage();

    page.strokes.forEach(
      (stroke) => {
        drawStroke(
          ctx,
          stroke,
          dpr
        );
      }
    );

    page.elements.forEach(
      (element) => {
        drawElement(
          ctx,
          element,
          dpr
        );
      }
    );

    clearInk();
  }

  function clearInk() {
    if (
      !inkCtx ||
      !inkCanvas
    ) {
      return;
    }

    inkCtx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    inkCtx.clearRect(
      0,
      0,
      inkCanvas.width,
      inkCanvas.height
    );
  }

  /*
   * ---------------------------------------------------------
   * ELEMENTS
   * ---------------------------------------------------------
   */

  function drawElement(
    target,
    element,
    dpr
  ) {
    if (
      element.type ===
      "text"
    ) {
      drawTextElement(
        target,
        element,
        dpr
      );

      return;
    }

    if (
      element.type ===
      "image"
    ) {
      drawImageElement(
        target,
        element
      );

      return;
    }

    if (
      element.type ===
      "shape"
    ) {
      drawShape(
        target,
        element,
        dpr
      );
    }
  }

  function drawTextElement(
    target,
    element
  ) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    target.save();

    target.fillStyle =
      element.color ||
      "#171717";

    target.font =
      `${element.size || 18}px system-ui, -apple-system, sans-serif`;

    target.textBaseline =
      "top";

    target.fillText(
      element.text,
      element.x * w,
      element.y * h
    );

    target.restore();
  }

  /*
   * ---------------------------------------------------------
   * SHAPES
   * ---------------------------------------------------------
   */

  function drawShape(
    target,
    shape,
    dpr
  ) {
    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

    const x =
      shape.x * w;

    const y =
      shape.y * h;

    const sw =
      shape.w * w;

    const sh =
      shape.h * h;

    target.save();

    target.strokeStyle =
      shape.color ||
      color;

    target.lineWidth =
      (shape.width || 3) *
      dpr;

    target.lineCap =
      "round";

    target.lineJoin =
      "round";

    target.beginPath();

    if (
      shape.shape ===
      "line"
    ) {
      target.moveTo(
        x,
        y
      );

      target.lineTo(
        x + sw,
        y + sh
      );
    }

    if (
      shape.shape ===
      "arrow"
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
      shape.shape ===
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
      shape.shape ===
      "ellipse"
    ) {
      target.ellipse(
        x + sw / 2,
        y + sh / 2,
        Math.abs(
          sw / 2
        ),
        Math.abs(
          sh / 2
        ),
        0,
        0,
        Math.PI * 2
      );
    }

    if (
      shape.shape ===
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

    target.restore();
  }

  function drawArrow(
    target,
    x1,
    y1,
    x2,
    y2
  ) {
    const angle =
      Math.atan2(
        y2 - y1,
        x2 - x1
      );

    const size = 9;

    target.moveTo(
      x1,
      y1
    );

    target.lineTo(
      x2,
      y2
    );

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        size *
          Math.cos(
            angle -
              Math.PI / 6
          ),
      y2 -
        size *
          Math.sin(
            angle -
              Math.PI / 6
          )
    );

    target.moveTo(
      x2,
      y2
    );

    target.lineTo(
      x2 -
        size *
          Math.cos(
            angle +
              Math.PI / 6
          ),
      y2 -
        size *
          Math.sin(
            angle +
              Math.PI / 6
          )
    );
  }

  /*
   * ---------------------------------------------------------
   * IMAGES
   * ---------------------------------------------------------
   */

  function drawImageElement(
    target,
    element
  ) {
    let image =
      imageCache.get(
        element.src
      );

    if (!image) {
      image =
        new Image();

      image.onload = () => {
        if (mounted) {
          renderCanvas();
        }
      };

      image.src =
        element.src;

      imageCache.set(
        element.src,
        image
      );

      return;
    }

    if (
      !image.complete
    ) {
      return;
    }

    const w =
      canvas.clientWidth;

    const h =
      canvas.clientHeight;

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

  function canvasPoint(
    event
  ) {
    const rect =
      canvas.getBoundingClientRect();

    return {
      x:
        (event.clientX -
          rect.left) /
        rect.width,

      y:
        (event.clientY -
          rect.top) /
        rect.height,
    };
  }

  function clamp01(
    value
  ) {
    return Math.max(
      0,
      Math.min(
        1,
        value
      )
    );
  }

  function normalizedPoint(
    event
  ) {
    const rect =
      canvas.getBoundingClientRect();

    return [
      clamp01(
        (event.clientX -
          rect.left) /
          rect.width
      ),

      clamp01(
        (event.clientY -
          rect.top) /
          rect.height
      ),
    ];
  }

  /*
   * ---------------------------------------------------------
   * UNDO / REDO
   * ---------------------------------------------------------
   */

  function snapshotPage() {
    const page =
      currentPage();

    return JSON.stringify({
      strokes:
        page.strokes || [],
      elements:
        page.elements || [],
    });
  }

  function restoreSnapshot(
    snapshot
  ) {
    if (!snapshot) {
      return;
    }

    const page =
      currentPage();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();
  }

  function pushUndo() {
    const page =
      currentPage();

    if (!page) {
      return;
    }

    undoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],
          elements:
            page.elements || [],
        })
      )
    );

    if (
      undoStack.length >
      80
    ) {
      undoStack.shift();
    }

    redoStack.length = 0;
  }

  function undo() {
    if (
      !undoStack.length
    ) {
      return;
    }

    const page =
      currentPage();

    redoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],
          elements:
            page.elements || [],
        })
      )
    );

    const snapshot =
      undoStack.pop();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();

    localSave();
  }

  function redo() {
    if (
      !redoStack.length
    ) {
      return;
    }

    const page =
      currentPage();

    undoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],
          elements:
            page.elements || [],
        })
      )
    );

    const snapshot =
      redoStack.pop();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();

    localSave();
  }
    /*
   * ---------------------------------------------------------
   * POINTER MAPPING
   * ---------------------------------------------------------
   */

  function canvasPoint(
    event
  ) {
    const rect =
      canvas.getBoundingClientRect();

    return {
      x:
        (event.clientX -
          rect.left) /
        rect.width,

      y:
        (event.clientY -
          rect.top) /
        rect.height,
    };
  }

  function clamp01(
    value
  ) {
    return Math.max(
      0,
      Math.min(
        1,
        value
      )
    );
  }

  function normalizedPoint(
    event
  ) {
    const rect =
      canvas.getBoundingClientRect();

    return [
      clamp01(
        (event.clientX -
          rect.left) /
          rect.width
      ),

      clamp01(
        (event.clientY -
          rect.top) /
          rect.height
      ),
    ];
  }

  /*
   * ---------------------------------------------------------
   * UNDO / REDO
   * ---------------------------------------------------------
   */

  function snapshotPage() {
    const page =
      currentPage();

    return JSON.stringify({
      strokes:
        page.strokes || [],

      elements:
        page.elements || [],
    });
  }

  function restoreSnapshot(
    snapshot
  ) {
    if (!snapshot) {
      return;
    }

    const page =
      currentPage();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();
  }

  function pushUndo() {
    const page =
      currentPage();

    if (!page) {
      return;
    }

    undoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],

          elements:
            page.elements || [],
        })
      )
    );

    if (
      undoStack.length >
      80
    ) {
      undoStack.shift();
    }

    redoStack.length = 0;
  }

  function undo() {
    if (
      !undoStack.length
    ) {
      return;
    }

    const page =
      currentPage();

    redoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],

          elements:
            page.elements || [],
        })
      )
    );

    const snapshot =
      undoStack.pop();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();

    localSave();
  }

  function redo() {
    if (
      !redoStack.length
    ) {
      return;
    }

    const page =
      currentPage();

    undoStack.push(
      JSON.parse(
        JSON.stringify({
          strokes:
            page.strokes || [],

          elements:
            page.elements || [],
        })
      )
    );

    const snapshot =
      redoStack.pop();

    page.strokes =
      snapshot.strokes || [];

    page.elements =
      snapshot.elements || [];

    renderCanvas();

    localSave();
  }

  /*
   * ---------------------------------------------------------
   * POINTER DOWN
   * ---------------------------------------------------------
   */

  function begin(event) {
    if (
      !inkCanvas
    ) {
      return;
    }

    if (
      event.pointerType ===
        "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();

    pointers.set(
      event.pointerId,
      {
        x:
          event.clientX,

        y:
          event.clientY,
      }
    );

    /*
     * Touch is navigation.
     */

    if (
      event.pointerType ===
      "touch"
    ) {
      return;
    }

    /*
     * Pencil / mouse only.
     */

    if (
      event.pointerType !==
        "pen" &&
      event.pointerType !==
        "mouse"
    ) {
      return;
    }

    try {
      inkCanvas.setPointerCapture(
        event.pointerId
      );
    } catch (_) {}

    /*
     * Text tool.
     */

    if (
      tool === "text"
    ) {
      addText(event);

      return;
    }

    /*
     * Eraser.
     */

    if (
      tool === "eraser"
    ) {
      eraserChanged =
        eraseAt(
          pointFromEvent(
            event
          )
        );

      return;
    }

    /*
     * New drawing invalidates redo.
     */

    redo = [];

    drawing = {
      tool,

      color,

      width:
        tool ===
        "highlighter"
          ? width * 3
          : width,

      points: [],

      pointerId:
        event.pointerId,

      createdAt:
        Date.now(),
    };

    currentPage()
      .strokes.push(
        drawing
      );

    /*
     * First point immediately.
     */

    addSamples([
      event,
    ]);
  }

  /*
   * ---------------------------------------------------------
   * POINTER MOVE
   * ---------------------------------------------------------
   */

  function move(event) {
    if (
      !pointers.has(
        event.pointerId
      )
    ) {
      return;
    }

    event.preventDefault();

    pointers.set(
      event.pointerId,
      {
        x:
          event.clientX,

        y:
          event.clientY,
      }
    );

    /*
     * Touch = pan.
     */

    if (
      event.pointerType ===
      "touch"
    ) {
      handleTouchPan();

      return;
    }

    /*
     * Continuous eraser.
     */

    if (
      tool === "eraser" &&
      (
        event.pointerType ===
          "pen" ||
        event.pointerType ===
          "mouse"
      )
    ) {
      const samples =
        typeof event.getCoalescedEvents ===
          "function"
          ? (
              event.getCoalescedEvents() ||
              [event]
            )
          : [event];

      for (
        const sample of
          samples
      ) {
        if (
          eraseAt(
            pointFromEvent(
              sample
            )
          )
        ) {
          eraserChanged =
            true;
        }
      }

      return;
    }

    /*
     * Pencil / mouse.
     */

    if (
      !drawing ||
      drawing.pointerId !==
        event.pointerId
    ) {
      return;
    }

    /*
     * getCoalescedEvents()
     * gives us the Pencil
     * samples between frames.
     */

    let events;

    if (
      typeof event.getCoalescedEvents ===
        "function"
    ) {
      events =
        event.getCoalescedEvents();

      if (
        !events ||
        !events.length
      ) {
        events = [
          event,
        ];
      }
    } else {
      events = [
        event,
      ];
    }

    addSamples(
      events
    );
  }

  /*
   * ---------------------------------------------------------
   * TOUCH PAN
   * ---------------------------------------------------------
   *
   * One finger:
   * pan.
   *
   * Two fingers:
   * pinch zoom + pan.
   *
   * Apple Pencil has priority
   * because Pencil events are
   * not touch events.
   */

  function handleTouchPan() {
    if (
      pointers.size === 1
    ) {
      const [
        pointer,
      ] =
        [...pointers.values()];

      const start =
        pointer.start;

      if (!start) {
        return;
      }

      pan = {
        x:
          pointer.x -
          start.x,

        y:
          pointer.y -
          start.y,
      };

      setZoom(zoom);

      return;
    }

    if (
      pointers.size < 2
    ) {
      return;
    }

    const entries =
      [...pointers.entries()];

    const a =
      entries[0][1];

    const b =
      entries[1][1];

    if (
      !a.gesture ||
      !b.gesture
    ) {
      return;
    }

    const distance =
      Math.hypot(
        a.x - b.x,
        a.y - b.y
      );

    const base =
      a.gesture.distance ||
      distance ||
      1;

    const centerX =
      (
        a.gesture.x +
        b.gesture.x
      ) / 2;

    const centerY =
      (
        a.gesture.y +
        b.gesture.y
      ) / 2;

    pan = {
      x:
        a.gesture.panX +
        (
          (
            a.x +
            b.x
          ) / 2 -
          centerX
        ),

      y:
        a.gesture.panY +
        (
          (
            a.y +
            b.y
          ) / 2 -
          centerY
        ),
    };

    setZoom(
      (
        a.gesture.zoom ||
        zoom
      ) *
        distance /
        base
    );
  }

  /*
   * ---------------------------------------------------------
   * POINTER UP / CANCEL
   * ---------------------------------------------------------
   */

  function finish(event) {
    /*
     * Final Pencil sample first.
     */

    if (
      drawing &&
      drawing.pointerId ===
        event.pointerId &&
      (
        event.pointerType ===
          "pen" ||
        event.pointerType ===
          "mouse"
      )
    ) {
      addSamples([
        event,
      ]);

      applyShapeRecognition();

      renderCanvas();

      drawing = null;

      localSave();
    }

    /*
     * Finish erasing.
     */

    if (
      tool === "eraser" &&
      (
        event.pointerType ===
          "pen" ||
        event.pointerType ===
          "mouse"
      ) &&
      eraserChanged
    ) {
      eraserChanged =
        false;

      localSave();
    }

    pointers.delete(
      event.pointerId
    );

    try {
      inkCanvas.releasePointerCapture(
        event.pointerId
      );
    } catch (_) {}

    if (
      event.pointerType ===
      "touch"
    ) {
      if (
        pointers.size === 0
      ) {
        pan = {
          x: 0,
          y: 0,
        };
      }
    }

    clearInk();
  }

  /*
   * ---------------------------------------------------------
   * POINTER SETUP
   * ---------------------------------------------------------
   */

  function preparePointerGesture(
    event
  ) {
    const existing =
      pointers.get(
        event.pointerId
      );

    if (!existing) {
      return;
    }

    existing.start = {
      x:
        event.clientX,

      y:
        event.clientY,
    };

    existing.x =
      event.clientX;

    existing.y =
      event.clientY;
  }

  /*
   * ---------------------------------------------------------
   * ERASER
   * ---------------------------------------------------------
   */

  function distancePointToSegment(
    px,
    py,
    ax,
    ay,
    bx,
    by
  ) {
    const dx =
      bx - ax;

    const dy =
      by - ay;

    if (
      dx === 0 &&
      dy === 0
    ) {
      return Math.hypot(
        px - ax,
        py - ay
      );
    }

    const t =
      Math.max(
        0,
        Math.min(
          1,
          (
            (px - ax) * dx +
            (py - ay) * dy
          ) /
            (
              dx * dx +
              dy * dy
            )
        )
      );

    return Math.hypot(
      px -
        (
          ax +
          t * dx
        ),

      py -
        (
          ay +
          t * dy
        )
    );
  }

  function eraseAt(
    at
  ) {
    const page =
      currentPage();

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

    let changed =
      false;

    const nextStrokes =
      [];

    page.strokes.forEach(
      (stroke) => {
        const points =
          stroke.points ||
          [];

        if (
          !points.length
        ) {
          return;
        }

        /*
         * Single-point stroke.
         */

        if (
          points.length === 1
        ) {
          const p =
            points[0];

          if (
            Math.hypot(
              p[0] -
                at[0],

              p[1] -
                at[1]
            ) <= radius
          ) {
            changed =
              true;
          } else {
            nextStrokes.push(
              stroke
            );
          }

          return;
        }

        let part = [];

        let hit =
          false;

        const flush =
          () => {
            if (
              part.length
            ) {
              nextStrokes.push({
                ...stroke,
                points:
                  part,
              });
            }

            part = [];
          };

        for (
          let i = 0;
          i < points.length;
          i++
        ) {
          const p =
            points[i];

          const pointHit =
            Math.hypot(
              p[0] -
                at[0],

              p[1] -
                at[1]
            ) <= radius;

          const segmentHit =
            i > 0 &&
            distancePointToSegment(
              at[0],
              at[1],

              points[i - 1][0],
              points[i - 1][1],

              p[0],
              p[1]
            ) <= radius;

          if (
            pointHit ||
            segmentHit
          ) {
            flush();

            hit =
              true;

            changed =
              true;
          } else {
            part.push(
              p
            );
          }
        }

        flush();

        if (!hit) {
          nextStrokes.push(
            stroke
          );
        }
      }
    );

    if (!changed) {
      return false;
    }

    page.strokes =
      nextStrokes;

    renderCanvas();

    return true;
  }  /*
   * ---------------------------------------------------------
   * AUTO SHAPE RECOGNITION
   * ---------------------------------------------------------
   */

  function recognizeShape(
    stroke
  ) {
    const points =
      stroke.points ||
      [];

    if (
      points.length < 4
    ) {
      return null;
    }

    const first =
      points[0];

    const last =
      points[
        points.length - 1
      ];

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

    const closed =
      Math.hypot(
        first[0] -
          last[0],

        first[1] -
          last[1]
      ) < 0.055;

    const near = (
      x,
      y
    ) =>
      points.some(
        (p) =>
          Math.hypot(
            p[0] - x,
            p[1] - y
          ) < 0.045
      );

    if (closed) {
      const rectangle =
        near(
          minX,
          minY
        ) &&
        near(
          maxX,
          minY
        ) &&
        near(
          maxX,
          maxY
        ) &&
        near(
          minX,
          maxY
        );

      const triangle =
        near(
          (
            minX +
            maxX
          ) / 2,

          minY
        ) &&
        near(
          minX,
          maxY
        ) &&
        near(
          maxX,
          maxY
        );

      return {
        type:
          "shape",

        shape:
          rectangle
            ? "rectangle"
            : triangle
            ? "triangle"
            : "ellipse",

        x:
          minX,

        y:
          minY,

        w:
          Math.max(
            w,
            0.001
          ),

        h:
          Math.max(
            h,
            0.001
          ),

        color:
          stroke.color,

        width:
          stroke.width,

        createdAt:
          stroke.createdAt ||
          Date.now(),
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

    if (!length) {
      return null;
    }

    const deviation =
      points.reduce(
        (
          sum,
          p
        ) => {
          const distance =
            Math.abs(
              dy * p[0] -
                dx * p[1] +
                last[0] *
                  first[1] -
                last[1] *
                  first[0]
            ) /
            length;

          return (
            sum +
            distance
          );
        },
        0
      ) /
      points.length;

    if (
      deviation < 0.01
    ) {
      return {
        type:
          "shape",

        shape:
          "line",

        x:
          first[0],

        y:
          first[1],

        w:
          dx,

        h:
          dy,

        color:
          stroke.color,

        width:
          stroke.width,

        createdAt:
          stroke.createdAt ||
          Date.now(),
      };
    }

    return null;
  }

  function makeManualShape(
    stroke,
    selected
  ) {
    const points =
      stroke.points ||
      [];

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
      type:
        "shape",

      shape:
        selected,

      x:
        minX,

      y:
        minY,

      w:
        Math.max(
          maxX - minX,
          0.001
        ),

      h:
        Math.max(
          maxY - minY,
          0.001
        ),

      color:
        stroke.color,

      width:
        stroke.width,

      createdAt:
        stroke.createdAt ||
        Date.now(),
    };
  }

  function applyShapeRecognition() {
    if (!drawing) {
      return;
    }

    if (
      !autoShapes &&
      !shapeTool
    ) {
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
        : recognizeShape(
            stroke
          );

    if (!shape) {
      return;
    }

    const page =
      currentPage();

    const index =
      page.strokes.indexOf(
        stroke
      );

    if (
      index >= 0
    ) {
      page.strokes.splice(
        index,
        1
      );
    }

    page.elements.push(
      shape
    );
  }

  /*
   * ---------------------------------------------------------
   * TEXT
   * ---------------------------------------------------------
   */

  function addText(
    event
  ) {
    const at =
      pointFromEvent(
        event
      );

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

    document.body.appendChild(
      input
    );

    input.focus();

    let finished =
      false;

    const commit =
      () => {
        if (finished) {
          return;
        }

        finished =
          true;

        const value =
          input.value.trim();

        input.remove();

        if (!value) {
          return;
        }

        currentPage()
          .elements.push({
            type:
              "text",

            text:
              value,

            x:
              at[0],

            y:
              at[1],

            color,

            size:
              Math.max(
                16,
                width * 5
              ),

            createdAt:
              Date.now(),
          });

        renderCanvas();

        localSave();
      };

    input.addEventListener(
      "keydown",
      (e) => {
        if (
          e.key ===
          "Enter"
        ) {
          commit();
        }

        if (
          e.key ===
          "Escape"
        ) {
          finished =
            true;

          input.remove();
        }
      }
    );

    input.addEventListener(
      "blur",
      commit,
      {
        once: true,
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * IMAGE IMPORT
   * ---------------------------------------------------------
   */

  function addImage(
    file
  ) {
    if (!file) {
      return;
    }

    const reader =
      new FileReader();

    reader.onload =
      () => {
        const src =
          reader.result;

        const image =
          new Image();

        image.onload =
          () => {
            const max =
              1600;

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
              off.getContext(
                "2d"
              );

            offCtx.drawImage(
              image,
              0,
              0,
              off.width,
              off.height
            );

            currentPage()
              .elements.push({
                type:
                  "image",

                src:
                  off.toDataURL(
                    "image/jpeg",
                    0.82
                  ),

                x:
                  0.12,

                y:
                  0.12,

                w:
                  0.76,

                h:
                  Math.min(
                    0.70,

                    0.76 *
                      (
                        off.height /
                        off.width
                      )
                  ),

                createdAt:
                  Date.now(),
              });

            renderCanvas();

            localSave();

            updateStatus(
              "Imagine adăugată"
            );
          };

        image.src =
          src;
      };

    reader.readAsDataURL(
      file
    );
  }

  /*
   * ---------------------------------------------------------
   * ZOOM
   * ---------------------------------------------------------
   */

  function setZoom(
    value
  ) {
    zoom =
      Math.max(
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
      `translate(-50%, -50%) ` +
      `translate(${pan.x}px, ${pan.y}px) ` +
      `scale(${zoom})`;

    const label =
      root.querySelector(
        "[data-zoom]"
      );

    if (label) {
      label.textContent =
        `${Math.round(
          zoom * 100
        )}%`;
    }
  }
    /*
   * ---------------------------------------------------------
   * FULLSCREEN
   * ---------------------------------------------------------
   */

  async function enterBrowserFullscreen() {
    const shell =
      root?.querySelector(
        ".notebook-shell"
      );

    if (
      !shell ||
      !document.documentElement.requestFullscreen
    ) {
      return false;
    }

    try {
      await shell.requestFullscreen();

      return true;
    } catch (_) {
      return false;
    }
  }

  async function exitBrowserFullscreen() {
    if (
      document.fullscreenElement &&
      document.exitFullscreen
    ) {
      try {
        await document.exitFullscreen();
      } catch (_) {}
    }
  }

  function applyFullscreenUi(
    value
  ) {
    fullscreen =
      value;

    const shell =
      root?.querySelector(
        ".notebook-shell"
      );

    if (!shell) {
      return;
    }

    shell.classList.toggle(
      "notebook-focus",
      fullscreen
    );

    document.body.style.overflow =
      fullscreen
        ? "hidden"
        : "";

    const button =
      root.querySelector(
        "[data-fullscreen]"
      );

    if (button) {
      button.innerHTML =
        fullscreen
          ? icons.exitFullscreen
          : icons.fullscreen;

      button.title =
        fullscreen
          ? "Ieși din fullscreen"
          : "Fullscreen";

      button.setAttribute(
        "aria-label",
        button.title
      );
    }

    const toolbar =
      root.querySelector(
        "[data-notebook-toolbar]"
      );

    toolbar?.classList.remove(
      "hidden"
    );

    requestAnimationFrame(
      () => {
        resizeCanvas();

        setZoom(zoom);
      }
    );

    if (fullscreen) {
      scheduleToolbarHide();
    }
  }

  async function setFullscreen(
    value
  ) {
    if (
      value === fullscreen
    ) {
      return;
    }

    if (value) {
      const success =
        await enterBrowserFullscreen();

      applyFullscreenUi(
        true
      );

      if (!success) {
        updateStatus(
          "Focus Mode"
        );
      }

      return;
    }

    if (
      document.fullscreenElement
    ) {
      await exitBrowserFullscreen();

      return;
    }

    applyFullscreenUi(
      false
    );
  }

  function scheduleToolbarHide() {
    if (!fullscreen) {
      return;
    }

    clearTimeout(
      toolbarHideTimer
    );

    toolbarHideTimer =
      setTimeout(
        () => {
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
        },
        2800
      );
  }

  function wakeToolbar() {
    if (!fullscreen) {
      return;
    }

    root
      ?.querySelector(
        "[data-notebook-toolbar]"
      )
      ?.classList.remove(
        "hidden"
      );

    scheduleToolbarHide();
  }

  /*
   * ---------------------------------------------------------
   * UNDO / REDO
   * ---------------------------------------------------------
   */

  function undo() {
    const page =
      currentPage();

    const lastStroke =
      page.strokes[
        page.strokes.length - 1
      ];

    const lastElement =
      page.elements[
        page.elements.length - 1
      ];

    if (
      !lastStroke &&
      !lastElement
    ) {
      return;
    }

    const strokeTime =
      Number(
        lastStroke?.createdAt ||
          0
      );

    const elementTime =
      Number(
        lastElement?.createdAt ||
          0
      );

    if (
      lastElement &&
      (
        !lastStroke ||
        elementTime >
          strokeTime
      )
    ) {
      redo.push({
        kind:
          "element",

        item:
          page.elements.pop(),
      });
    } else {
      redo.push({
        kind:
          "stroke",

        item:
          page.strokes.pop(),
      });
    }

    renderCanvas();

    localSave();
  }

  function redoLast() {
    const action =
      redo.pop();

    if (!action) {
      return;
    }

    if (
      action.kind ===
      "element"
    ) {
      currentPage()
        .elements.push(
          action.item
        );
    } else {
      currentPage()
        .strokes.push(
          action.item
        );
    }

    renderCanvas();

    localSave();
  }

  /*
   * ---------------------------------------------------------
   * BINDINGS
   * ---------------------------------------------------------
   */

  function bind() {
    /*
     * Tools.
     */

    root
      .querySelectorAll(
        "[data-tool]"
      )
      .forEach(
        (button) => {
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
                      item ===
                        button
                    );
                  }
                );

              wakeToolbar();
            }
          );
        }
      );

    /*
     * Auto shapes.
     */

    root
      .querySelector(
        "[data-auto-shapes]"
      )
      .addEventListener(
        "click",
        (event) => {
          autoShapes =
            !autoShapes;

          if (
            autoShapes
          ) {
            shapeTool =
              "";

            const select =
              root.querySelector(
                "[data-shape]"
              );

            if (select) {
              select.value =
                "";
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

          wakeToolbar();
        }
      );

    /*
     * Manual shape.
     */

    root
      .querySelector(
        "[data-shape]"
      )
      .addEventListener(
        "change",
        (event) => {
          shapeTool =
            event.target.value;

          if (
            shapeTool
          ) {
            autoShapes =
              false;

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

          wakeToolbar();
        }
      );

    /*
     * Color picker.
     */

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

          wakeToolbar();
        }
      );

    /*
     * Color circles.
     */

    root
      .querySelectorAll(
        "[data-swatch]"
      )
      .forEach(
        (button) => {
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

              wakeToolbar();
            }
          );
        }
      );

    /*
     * Width.
     */

    const widthControl =
      root.querySelector(
        "[data-width-control]"
      );

    const widthToggle =
      root.querySelector(
        "[data-width-toggle]"
      );

    const widthInput =
      root.querySelector(
        "[data-width]"
      );

    const widthValue =
      root.querySelector(
        "[data-width-value]"
      );

    const widthPreview =
      root.querySelector(
        "[data-width-preview]"
      );

    const updateWidthUi =
      () => {
        if (widthInput) {
          widthInput.value =
            String(width);
        }

        if (widthValue) {
          widthValue.textContent =
            String(width);
        }

        if (widthPreview) {
          const size =
            Math.max(
              4,
              Math.min(
                20,
                3 +
                  width *
                    0.85
              )
            );

          widthPreview.style.width =
            size + "px";

          widthPreview.style.height =
            size + "px";
        }
      };

    widthInput?.addEventListener(
      "input",
      (event) => {
        width =
          Number(
            event.target.value
          );

        updateWidthUi();

        wakeToolbar();
      }
    );

    widthToggle?.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        const open =
          widthControl.classList.toggle(
            "open"
          );

        widthToggle.setAttribute(
          "aria-expanded",
          String(open)
        );

        updateWidthUi();

        wakeToolbar();
      }
    );

    root.addEventListener(
      "pointerdown",
      (event) => {
        if (
          widthControl &&
          !widthControl.contains(
            event.target
          )
        ) {
          widthControl.classList.remove(
            "open"
          );

          widthToggle?.setAttribute(
            "aria-expanded",
            "false"
          );
        }
      },
      {
        passive: true,
      }
    );

    updateWidthUi();

    /*
     * Template.
     */

    root
      .querySelector(
        "[data-template]"
      )
      .addEventListener(
        "change",
        (event) => {
          currentPage()
            .template =
            event.target.value;

          renderCanvas();

          localSave();
        }
      );

    /*
     * Orientation.
     */

    root
      .querySelector(
        "[data-orientation]"
      )
      .addEventListener(
        "change",
        (event) => {
          currentPage()
            .orientation =
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

    /*
     * Undo.
     */

    root
      .querySelector(
        "[data-undo]"
      )
      .addEventListener(
        "click",
        undo
      );

    /*
     * Redo.
     */

    root
      .querySelector(
        "[data-redo]"
      )
      .addEventListener(
        "click",
        redoLast
      );

    /*
     * Zoom.
     */

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

          wakeToolbar();
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

          wakeToolbar();
        }
      );

    /*
     * Fullscreen.
     */

    root
      .querySelector(
        "[data-fullscreen]"
      )
      .addEventListener(
        "click",
        async () => {
          await setFullscreen(
            !fullscreen
          );
        }
      );

    /*
     * Image.
     */

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
            event.target
              .files?.[0]
          );

          event.target.value =
            "";
        }
      );

    /*
     * Previous page.
     */

    root
      .querySelector(
        "[data-prev]"
      )
      .addEventListener(
        "click",
        () => {
          if (
            activePage <=
            0
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

    /*
     * Next page.
     */

    root
      .querySelector(
        "[data-next]"
      )
      .addEventListener(
        "click",
        () => {
          if (
            activePage >=
            notebook.pages
              .length -
              1
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

    /*
     * Add page.
     */

    root
      .querySelector(
        "[data-add-page]"
      )
      .addEventListener(
        "click",
        () => {
          notebook.pages.push({
            template:
              currentPage()
                .template,

            background:
              currentPage()
                .background,

            orientation:
              currentPage()
                .orientation,

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

          render();

          localSave();
        }
      );

    /*
     * -------------------------------------------------------
     * PENCIL / POINTER EVENTS
     * -------------------------------------------------------
     */

    inkCanvas.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.pointerType ===
          "touch"
        ) {
          pointers.set(
            event.pointerId,
            {
              x:
                event.clientX,

              y:
                event.clientY,

              start: {
                x:
                  event.clientX,

                y:
                  event.clientY,
              },
            }
          );

          if (
            pointers.size >=
            2
          ) {
            const entries =
              [
                ...pointers.values(),
              ];

            const a =
              entries[0];

            const b =
              entries[1];

            const distance =
              Math.hypot(
                a.x - b.x,
                a.y - b.y
              );

            for (
              const pointer of
                entries
            ) {
              pointer.gesture = {
                x:
                  (
                    a.x +
                    b.x
                  ) / 2,

                y:
                  (
                    a.y +
                    b.y
                  ) / 2,

                distance,

                zoom,

                panX:
                  pan.x,

                panY:
                  pan.y,
              };
            }
          }

          return;
        }

        begin(event);
      },
      {
        passive: false,
      }
    );

    inkCanvas.addEventListener(
      "pointermove",
      move,
      {
        passive: false,
      }
    );

    inkCanvas.addEventListener(
      "pointerup",
      finish,
      {
        passive: false,
      }
    );

    inkCanvas.addEventListener(
      "pointercancel",
      finish,
      {
        passive: false,
      }
    );

    inkCanvas.addEventListener(
      "pointerleave",
      () => {
        /*
         * Pointer capture keeps Pencil
         * drawing alive when it briefly
         * leaves the canvas bounds.
         */
      }
    );

    inkCanvas.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
      }
    );

    /*
     * Toolbar wake.
     */

    root.addEventListener(
      "pointermove",
      (event) => {
        if (
          fullscreen &&
          event.clientY <
            100
        ) {
          wakeToolbar();
        }
      },
      {
        passive: true,
      }
    );

    /*
     * Fullscreen state.
     */

    document.addEventListener(
      "fullscreenchange",
      handleFullscreenChange
    );

    /*
     * Keyboard shortcuts.
     */

    document.addEventListener(
      "keydown",
      handleKeydown
    );

    /*
     * Resize observer.
     */

    if (
      typeof ResizeObserver !==
      "undefined"
    ) {
      resizeObserver =
        new ResizeObserver(
          () => {
            resizeCanvas();
          }
        );

      resizeObserver.observe(
        root.querySelector(
          "[data-notebook-stage]"
        )
      );
    }

    updateSwatches();
  }

  /*
   * ---------------------------------------------------------
   * FULLSCREEN CHANGE
   * ---------------------------------------------------------
   */

  function handleFullscreenChange() {
    if (
      !document.fullscreenElement &&
      fullscreen
    ) {
      applyFullscreenUi(
        false
      );

      return;
    }

    if (
      document.fullscreenElement &&
      !fullscreen
    ) {
      applyFullscreenUi(
        true
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * KEYBOARD
   * ---------------------------------------------------------
   */

  function handleKeydown(
    event
  ) {
    if (
      event.key ===
        "Escape" &&
      fullscreen &&
      !document.fullscreenElement
    ) {
      applyFullscreenUi(
        false
      );

      return;
    }

    if (
      (
        event.metaKey ||
        event.ctrlKey
      ) &&
      event.key.toLowerCase() ===
        "z"
    ) {
      event.preventDefault();

      undo();

      return;
    }

    if (
      (
        event.metaKey ||
        event.ctrlKey
      ) &&
      event.key.toLowerCase() ===
        "y"
    ) {
      event.preventDefault();

      redoLast();
    }
  }

  /*
   * ---------------------------------------------------------
   * SWATCHES
   * ---------------------------------------------------------
   */

  function updateSwatches() {
    root
      ?.querySelectorAll(
        "[data-swatch]"
      )
      .forEach(
        (button) => {
          const selected =
            button.dataset.swatch
              .toLowerCase() ===
            color.toLowerCase();

          button.classList.toggle(
            "notebook-swatch-selected",
            selected
          );

          button.setAttribute(
            "aria-pressed",
            String(
              selected
            )
          );
        }
      );
  }

  /*
   * ---------------------------------------------------------
   * MOUNT
   * ---------------------------------------------------------
   */

  async function mount(
    subjectId
  ) {
    root =
      document.getElementById(
        "notebookViewRoot"
      );

    if (!root) {
      return;
    }

    mounted = true;

    root.innerHTML = `
      <div
        class="subjects-spa-state"
      >
        Se deschide caietul…
      </div>
    `;

    try {
      const {
        data: {
          session,
        },
      } =
        await supabaseClient.auth
          .getSession();

      if (!mounted) {
        return;
      }

      user =
        session?.user;

      if (!user) {
        root.innerHTML = `
          <div
            class="subjects-spa-state"
          >
            Trebuie să fii autentificat.
          </div>
        `;

        return;
      }

      const {
        data,
      } =
        await supabaseClient
          .from("subjects")
          .select(
            "id,name,color"
          )
          .eq(
            "id",
            subjectId
          )
          .eq(
            "user_id",
            user.id
          )
          .maybeSingle();

      if (!mounted) {
        return;
      }

      if (!data) {
        root.innerHTML = `
          <div
            class="subjects-spa-state"
          >
            Caietul nu a fost găsit.
          </div>
        `;

        return;
      }

      subject =
        data;

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
    } catch (_) {
      if (!mounted) {
        return;
      }

      root.innerHTML = `
        <div
          class="subjects-spa-state"
        >
          Nu am putut deschide caietul.
        </div>
      `;
    }
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

    clearTimeout(
      localCacheTimer
    );

    if (
      notebook
    ) {
      try {
        localStorage.setItem(
          storageKey(),
          JSON.stringify(
            notebook
          )
        );
      } catch (_) {}
    }

    if (
      resizeObserver
    ) {
      resizeObserver.disconnect();

      resizeObserver =
        null;
    }

    document.removeEventListener(
      "keydown",
      handleKeydown
    );

    document.removeEventListener(
      "fullscreenchange",
      handleFullscreenChange
    );

    if (
      document.fullscreenElement
    ) {
      try {
        document.exitFullscreen();
      } catch (_) {}
    }

    document.body.style.overflow =
      "";

    mounted = false;

    fullscreen = false;

    root = null;

    canvas = null;

    ctx = null;

    inkCanvas = null;

    inkCtx = null;

    drawing = null;

    pointers.clear();
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
  