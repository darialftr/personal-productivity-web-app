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

    .notebook-page-controls span {
      font-size: 11px;
      opacity: .58;
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

    /*
     * Floating Apple-like toolbar.
     */

    .notebook-focus .notebook-toolbar {
      position: fixed;

      z-index: 1000001;

      top:
        max(
          10px,
          env(safe-area-inset-top)
        );

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
        0 12px 38px rgba(0, 0, 0, .12),
        inset 0 1px 0 rgba(255, 255, 255, .95);

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
    .notebook-toolbar
    button {
      width: 37px;
      height: 37px;

      border-radius: 14px;
    }

    .notebook-focus
    .notebook-toolbar
    button.active {
      background: var(--nb-accent);
      color: white;
    }

    .notebook-focus
    .notebook-toolbar
    select,
    .notebook-focus
    .notebook-toolbar
    input[type="range"] {
      display: none;
    }

    /*
     * In fullscreen, the sheet gets the entire viewport.
     */

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
     * Page controls become a little floating pill.
     */

    .notebook-focus .notebook-page-controls {
      position: fixed;

      z-index: 1000000;

      bottom:
        max(
          13px,
          env(safe-area-inset-bottom)
        );

      left: 50%;

      margin: 0;

      padding: 6px 8px;

      border-radius: 19px;

      background:
        rgba(255, 255, 255, .70);

      box-shadow:
        0 9px 28px rgba(0, 0, 0, .10);

      backdrop-filter:
        blur(18px);

      -webkit-backdrop-filter:
        blur(18px);

      transform:
        translateX(-50%);
    }

    /*
     * Fullscreen button is moved to top-right.
     */

    .notebook-focus
    .notebook-fullscreen-button {
      position: fixed;

      z-index: 1000002;

      top:
        max(
          10px,
          env(safe-area-inset-top)
        );

      right:
        max(
          10px,
          env(safe-area-inset-right)
        );

      width: 37px;
      height: 37px;

      margin: 0;

      border-radius: 14px;

      background:
        rgba(255, 255, 255, .78);

      color: #171717;

      box-shadow:
        0 6px 20px rgba(0, 0, 0, .10);
    }

    /*
     * -------------------------------------------------------
     * TEXT EDITOR
     * -------------------------------------------------------
     */

    .notebook-text-editor {
      position: fixed;

      z-index: 1000010;

      min-width: 130px;

      border:
        1px solid
        rgba(0, 0, 0, .12);

      border-radius: 13px;

      padding: 9px 11px;

      outline: none;

      background:
        rgba(255, 255, 255, .97);

      color: #171717;

      box-shadow:
        0 8px 28px rgba(0, 0, 0, .14);

      font:
        16px
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        sans-serif;
    }

    /*
     * -------------------------------------------------------
     * DARK MODE
     * -------------------------------------------------------
     */

    @media (prefers-color-scheme: dark) {
      .notebook-focus
      .notebook-toolbar {
        background:
          rgba(35, 35, 38, .74);

        color: #fff;

        border-color:
          rgba(255, 255, 255, .10);

        box-shadow:
          0 12px 38px rgba(0, 0, 0, .30),
          inset 0 1px 0
          rgba(255, 255, 255, .08);
      }

      .notebook-focus
      .notebook-fullscreen-button {
        background:
          rgba(35, 35, 38, .82);

        color: #fff;
      }

      .notebook-focus
      .notebook-page-controls {
        background:
          rgba(35, 35, 38, .74);

        color: #fff;
      }
    }

    /*
     * -------------------------------------------------------
     * MOBILE
     * -------------------------------------------------------
     */

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
        height:
          calc(100dvh - 210px);

        min-height: 400px;
      }
    }
  `;

  /*
   * ---------------------------------------------------------
   * ICONS
   * ---------------------------------------------------------
   */

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

  /*
   * ---------------------------------------------------------
   * STYLE INJECTION
   * ---------------------------------------------------------
   */

  function injectStyles() {
    if (
      document.getElementById(
        "itera-notebook-styles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "itera-notebook-styles";

    style.textContent = styles;

    document.head.appendChild(style);
  }

  /*
   * ---------------------------------------------------------
   * NOTEBOOK DATA
   * ---------------------------------------------------------
   */

  function freshNotebook() {
    return {
      version: 6,

      pages: [
        {
          template: "lined",

          background:
            "#fffdf9",

          orientation:
            "portrait",

          strokes: [],

          elements: [],
        },
      ],

      updatedAt:
        Date.now(),
    };
  }

  function currentPage() {
    return notebook.pages[activePage];
  }

  function storageKey() {
    return (
      `itera:notebook:` +
      `${user?.id || "guest"}:` +
      `${subject?.id || "subject"}`
    );
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
      notebook =
        freshNotebook();
    }

    notebook.pages.forEach(
      (page) => {
        page.template ||= "lined";

        page.background ||=
          "#fffdf9";

        page.orientation ||=
          "portrait";

        page.strokes ||= [];

        page.elements ||= [];

        page.strokes.forEach(
          (stroke) => {
            stroke.points ||= [];

            stroke.tool ||= "gel";

            stroke.color ||=
              "#4d4260";

            stroke.width ||= 3;
          }
        );
      }
    );
  }

  function loadLocal() {
    try {
      const saved =
        JSON.parse(
          localStorage.getItem(
            storageKey()
          ) || "null"
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

  /*
   * ---------------------------------------------------------
   * CLOUD
   * ---------------------------------------------------------
   */

  async function loadCloud() {
    try {
      const {
        data,
        error,
      } = await supabaseClient
        .from("notebooks")
        .select(
          "content,updated_at"
        )
        .eq(
          "user_id",
          user.id
        )
        .eq(
          "subject_id",
          subject.id
        )
        .maybeSingle();

      if (
        error ||
        !data?.content ||
        !Array.isArray(
          data.content.pages
        ) ||
        !mounted
      ) {
        return;
      }

      const cloudTime =
        Number(
          data.content.updatedAt ||
            0
        );

      const localTime =
        Number(
          notebook.updatedAt ||
            0
        );

      if (
        cloudTime > localTime
      ) {
        notebook =
          data.content;

        normalizeNotebook();

        activePage =
          Math.min(
            activePage,
            notebook.pages.length - 1
          );

        renderCanvas();

        updateStatus(
          "Sincronizat"
        );
      }
    } catch (_) {}
  }

  /*
   * Supabase is intentionally delayed.
   * It never runs from pointermove.
   */

  function scheduleSave() {
    clearTimeout(saveTimer);

    saveTimer =
      setTimeout(() => {
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

      if (
        drawing ||
        pointers.size
      ) {
        saveQueued = true;
        break;
      }

      const version =
        ++saveVersion;

      notebook.updatedAt =
        Date.now();

      let snapshot;

      try {
        snapshot =
          typeof structuredClone ===
          "function"
            ? structuredClone(
                notebook
              )
            : JSON.parse(
                JSON.stringify(
                  notebook
                )
              );
      } catch (_) {
        break;
      }

      try {
        const result =
          await supabaseClient
            .from("notebooks")
            .upsert(
              {
                user_id:
                  user.id,

                subject_id:
                  subject.id,

                content:
                  snapshot,

                updated_at:
                  new Date().toISOString(),
              },
              {
                onConflict:
                  "user_id,subject_id",
              }
            );

        if (
          result?.error
        ) {
          throw result.error;
        }

        if (
          mounted &&
          version ===
            saveVersion &&
          !drawing &&
          !pointers.size
        ) {
          updateStatus(
            "Salvat"
          );
        }
      } catch (_) {
        updateStatus(
          "Salvat local"
        );
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
      ?.querySelector(
        "[data-notebook-status]"
      )
      ?.replaceChildren(text);
  }

  /*
   * ---------------------------------------------------------
   * RENDER UI
   * ---------------------------------------------------------
   */

  function render() {
    if (
      !root ||
      !notebook ||
      !subject
    ) {
      return;
    }

    injectStyles();

    const page =
      currentPage();

    root.innerHTML = `
      <a
        class="subjects-spa-back"
        href="#/subjects/${subject.id}"
      >
        ← ${escapeHtml(
          subject.name
        )}
      </a>

      <section
        class="notebook-shell"
        style="--nb-accent:${
          subject.color ||
          "#f3a9c5"
        }"
      >

        <header class="notebook-head">

          <div
            class="notebook-title-icon"
          >
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
            <p class="eyebrow">
              Caietul tău
            </p>

            <h2>
              ${escapeHtml(
                subject.name
              )}
            </h2>
          </div>

          <small
            data-notebook-status
          >
            Pregătit
          </small>

        </header>

        <div
          class="notebook-toolbar"
          data-notebook-toolbar
        >

          ${toolButton(
            "gel",
            icons.gel,
            "Pix gel"
          )}

          ${toolButton(
            "ballpoint",
            icons.ballpoint,
            "Pix"
          )}

          ${toolButton(
            "pencil",
            icons.pencil,
            "Creion"
          )}

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

          ${toolButton(
            "text",
            icons.text,
            "Text"
          )}

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
          >
            ${Math.round(
              zoom * 100
            )}%
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
            title="Culoare"
            aria-label="Culoare"
          />

          <span
            class="notebook-swatches"
          >
            ${palette
              .map(
                (c) => `
                  <button
                    type="button"
                    data-swatch="${c}"
                    style="background:${c}"
                    aria-label="Culoare ${c}"
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

          <select
            data-shape
            title="Formă"
          >
            <option value="">
              Liber
            </option>

            <option value="line">
              Linie
            </option>

            <option value="arrow">
              Săgeată
            </option>

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

          <select
            data-template
            title="Pagină"
          >
            ${Object.entries(
              templates
            )
              .map(
                ([id, label]) => `
                  <option
                    value="${id}"
                    ${
                      page.template === id
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
              A4 portret
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

        <div
          class="notebook-page-controls"
        >
          <button
            data-prev
            aria-label="Pagina anterioară"
          >
            ‹
          </button>

          <span
            data-page-label
          >
            Pagina ${
              activePage + 1
            }
            /
            ${notebook.pages.length}
          </span>

          <button
            data-next
            aria-label="Pagina următoare"
          >
            ›
          </button>

          <button
            data-add-page
            aria-label="Pagină nouă"
          >
            ＋
          </button>
        </div>

      </section>
    `;

    canvas =
      root.querySelector(
        "[data-notebook-canvas]"
      );

    inkCanvas =
      root.querySelector(
        "[data-notebook-ink]"
      );

    ctx =
      canvas.getContext(
        "2d",
        {
          alpha: false,
          desynchronized: true,
        }
      );

    inkCtx =
      inkCanvas.getContext(
        "2d",
        {
          alpha: true,
          desynchronized: true,
        }
      );

    bind();

    resizeCanvas();

    renderCanvas();

    updateSwatches();

    setZoom(zoom);
  }

  function toolButton(
    id,
    icon,
    title
  ) {
    return `
      <button
        data-tool="${id}"
        class="${
          tool === id
            ? "active"
            : ""
        }"
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
    return currentPage()
      .orientation ===
      "landscape"
      ? 297 / 210
      : 210 / 297;
  }

  function resizeCanvas() {
    if (
      !canvas ||
      !inkCanvas ||
      !root
    ) {
      return;
    }

    const stage =
      root.querySelector(
        "[data-notebook-stage]"
      );

    const sheet =
      root.querySelector(
        "[data-notebook-sheet]"
      );

    if (
      !stage ||
      !sheet
    ) {
      return;
    }

    const stageWidth =
      stage.clientWidth;

    const stageHeight =
      stage.clientHeight;

    const aspect =
      pageAspect();

    let widthPx =
      stageWidth * 0.72;

    let heightPx =
      widthPx / aspect;

    if (
      heightPx >
      stageHeight * 0.90
    ) {
      heightPx =
        stageHeight * 0.90;

      widthPx =
        heightPx * aspect;
    }

    if (
      widthPx < 280 &&
      stageWidth >= 280
    ) {
      widthPx = 280;
      heightPx =
        widthPx / aspect;
    }

    /*
     * Fullscreen:
     *
     * Fit the whole A4 page into the viewport,
     * leaving comfortable space around it.
     */

    if (fullscreen) {
      const safeWidth =
        stageWidth * 0.92;

      const safeHeight =
        stageHeight * 0.92;

      widthPx =
        Math.min(
          safeWidth,
          safeHeight * aspect
        );

      heightPx =
        widthPx / aspect;
    }

    sheet.style.width =
      `${widthPx}px`;

    sheet.style.height =
      `${heightPx}px`;

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
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

    /*
     * Avoid resetting the canvas if its
     * backing dimensions have not changed.
     *
     * This is important for Pencil latency.
     */

    const changed =
      canvas.width !==
        pixelWidth ||
      canvas.height !==
        pixelHeight;

    if (changed) {
      canvas.width =
        pixelWidth;

      canvas.height =
        pixelHeight;

      inkCanvas.width =
        pixelWidth;

      inkCanvas.height =
        pixelHeight;

      canvas.style.width =
        `${widthPx}px`;

      canvas.style.height =
        `${heightPx}px`;

      inkCanvas.style.width =
        `${widthPx}px`;

      inkCanvas.style.height =
        `${heightPx}px`;

      renderCanvas();

      clearInk();
    } else {
      canvas.style.width =
        `${widthPx}px`;

      canvas.style.height =
        `${heightPx}px`;

      inkCanvas.style.width =
        `${widthPx}px`;

      inkCanvas.style.height =
        `${heightPx}px`;
    }

    setZoom(zoom);
  }

  /*
   * ---------------------------------------------------------
   * PAPER
   * ---------------------------------------------------------
   */

  function paintPaper() {
    if (
      !ctx ||
      !canvas
    ) {
      return;
    }

    const w =
      canvas.width;

    const h =
      canvas.height;

    const dpr =
      Math.min(
        global.devicePixelRatio ||
          1,
        2
      );

    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      w,
      h
    );

    ctx.fillStyle =
      currentPage()
        .background ||
      "#fffdf9";

    ctx.fillRect(
      0,
      0,
      w,
      h
    );

    const template =
      currentPage()
        .template;

    if (
      template ===
      "blank"
    ) {
      return;
    }

    ctx.save();

    ctx.strokeStyle =
      template === "grid"
        ? "rgba(110,130,160,.12)"
        : "rgba(100,120,160,.18)";

    ctx.lineWidth =
      1 * dpr;

    if (
      template ===
      "grid"
    ) {
      const gap =
        22 * dpr;

      for (
        let x = gap;
        x < w;
        x += gap
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
        let y = gap;
        y < h;
        y += gap
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
    } else {
      const gap =
        31 * dpr;

      for (
        let y = gap;
        y < h;
        y += gap
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
        "rgba(230,100,130,.16)";

      ctx.beginPath();

      ctx.moveTo(
        58 * dpr,
        0
      );

      ctx.lineTo(
        58 * dpr,
        h
      );

      ctx.stroke();
    }

    ctx.restore();
  }

  /*
   * ---------------------------------------------------------
   * STATIC RENDER
   * ---------------------------------------------------------
   */

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
   * HANDWRITING SMOOTHING
   * ---------------------------------------------------------
   *
   * The old version moved points toward their neighbours.
   * That is mathematically nice but can make the visible
   * stroke feel delayed because the next point is needed.
   *
   * We therefore use a very light smoothing pass for the
   * already received points only.
   *
   * During the live stroke, we don't wait for future samples.
   */

  function smoothForDisplay(
    points
  ) {
    if (
      !points ||
      points.length < 3
    ) {
      return points || [];
    }

    const result = [
      points[0],
    ];

    /*
     * Small value on purpose.
     *
     * This removes jitter without
     * making handwriting feel "rubbery".
     */

    const amount = 0.12;

    for (
      let i = 1;
      i <
        points.length - 1;
      i++
    ) {
      const prev =
        points[i - 1];

      const current =
        points[i];

      const next =
        points[i + 1];

      result.push([
        current[0] +
          (
            (
              prev[0] +
              next[0]
            ) /
              2 -
            current[0]
          ) *
            amount,

        current[1] +
          (
            (
              prev[1] +
              next[1]
            ) /
              2 -
            current[1]
          ) *
            amount,

        current[2],
      ]);
    }

    result.push(
      points[
        points.length - 1
      ]
    );

    return result;
  }

  /*
   * ---------------------------------------------------------
   * DRAW STROKE
   * ---------------------------------------------------------
   */

  function drawStroke(
    target,
    stroke,
    dpr
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

    const smooth =
      smoothForDisplay(
        points
      );

    const alpha =
      stroke.tool ===
      "highlighter"
        ? 0.24
        : stroke.tool ===
          "pencil"
        ? 0.72
        : 1;

    target.save();

    target.globalAlpha =
      alpha;

    target.strokeStyle =
      stroke.color ||
      color;

    target.fillStyle =
      stroke.color ||
      color;

    target.lineCap =
      "round";

    target.lineJoin =
      "round";

    /*
     * Tiny stroke / dot.
     */

    if (
      smooth.length === 1
    ) {
      const p =
        smooth[0];

      const pressure =
        Number(p[2]) || 1;

      const radius =
        Math.max(
          0.7,
          stroke.width *
            pressure *
            0.48
        ) * dpr;

      target.beginPath();

      target.arc(
        p[0] * w * dpr,
        p[1] * h * dpr,
        radius,
        0,
        Math.PI * 2
      );

      target.fill();

      target.restore();

      return;
    }

    /*
     * Two-point strokes are rendered directly.
     * This makes tiny i/t/punctuation strokes
     * appear without waiting for a third point.
     */

    if (
      smooth.length === 2
    ) {
      const a =
        smooth[0];

      const b =
        smooth[1];

      const pressure =
        (
          Number(a[2]) || 1
        ) +
        (
          Number(b[2]) || 1
        );

      target.lineWidth =
        stroke.width *
        (pressure / 2) *
        dpr;

      target.beginPath();

      target.moveTo(
        a[0] * w * dpr,
        a[1] * h * dpr
      );

      target.lineTo(
        b[0] * w * dpr,
        b[1] * h * dpr
      );

      target.stroke();

      target.restore();

      return;
    }

    /*
     * Normal handwriting.
     */

    for (
      let i = 1;
      i < smooth.length;
      i++
    ) {
      const a =
        smooth[i - 1];

      const b =
        smooth[i];

      const next =
        smooth[i + 1] ||
        b;

      const pressure =
        (
          Number(a[2]) || 1
        ) +
        (
          Number(b[2]) || 1
        );

      target.lineWidth =
        stroke.width *
        (pressure / 2) *
        dpr;

      const ax =
        a[0] *
        w *
        dpr;

      const ay =
        a[1] *
        h *
        dpr;

      const bx =
        b[0] *
        w *
        dpr;

      const by =
        b[1] *
        h *
        dpr;

      target.beginPath();

      target.moveTo(
        ax,
        ay
      );

      if (
        i <
        smooth.length - 1
      ) {
        const nx =
          (
            (
              b[0] +
              next[0]
            ) /
              2
          ) *
          w *
          dpr;

        const ny =
          (
            (
              b[1] +
              next[1]
            ) /
              2
          ) *
          h *
          dpr;

        target.quadraticCurveTo(
          bx,
          by,
          nx,
          ny
        );
      } else {
        target.lineTo(
          bx,
          by
        );
      }

      target.stroke();
    }

    target.restore();
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
        Math.abs(sw / 2),
        Math.abs(sh / 2),
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

  function pointFromEvent(
    event
  ) {
    const rect =
      inkCanvas.getBoundingClientRect();

    const x =
      (
        event.clientX -
        rect.left
      ) / rect.width;

    const y =
      (
        event.clientY -
        rect.top
      ) / rect.height;

    /*
     * Pencil pressure:
     *
     * We don't exaggerate pressure too much.
     * Very light Pencil strokes remain visible.
     */

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
   * LIVE INK
   * ---------------------------------------------------------
   */

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

  /*
   * Add every useful sample.
   *
   * The only sample we remove is an EXACT duplicate.
   */

  function addSamples(
    events
  ) {
    if (!drawing) {
      return;
    }

    for (
      const event of events
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

      const p =
        pointFromEvent(
          event
        );

      const last =
        drawing.points[
          drawing.points.length -
            1
        ];

      if (
        last &&
        p[0] === last[0] &&
        p[1] === last[1] &&
        p[2] === last[2]
      ) {
        continue;
      }

      drawing.points.push(
        p
      );
    }

    drawLive();
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

    /*
     * Touch is navigation.
     */

    pointers.set(
      event.pointerId,
      {
        x:
          event.clientX,

        y:
          event.clientY,
      }
    );

    if (
      event.pointerType ===
      "touch"
    ) {
      return;
    }

    /*
     * Pencil / mouse.
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
      eraseAt(
        pointFromEvent(
          event
        )
      );

      return;
    }

    /*
     * A new drawing invalidates redo.
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
     * FIRST POINT:
     * immediately.
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
     * gives us all Pencil samples
     * between browser frames.
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
   * One finger touch:
   * pan.
   *
   * Two finger touch:
   * pinch zoom + pan.
   *
   * Apple Pencil always has priority because
   * Pencil events are not touch events.
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
     * Process the final Pencil sample FIRST.
     *
     * This fixes tiny missing endings.
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

      /*
       * Render the finished stroke
       * onto the static layer immediately.
       */

      renderCanvas();

      drawing = null;

      localSave();
    }

    /*
     * Remove pointer.
     */

    pointers.delete(
      event.pointerId
    );

    try {
      inkCanvas.releasePointerCapture(
        event.pointerId
      );
    } catch (_) {}

    /*
     * Prepare touch gesture state
     * for the next gesture.
     */

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

    let changed = false;

    page.strokes =
      page.strokes.filter(
        (stroke) => {
          const hit =
            stroke.points.some(
              (point) =>
                Math.hypot(
                  point[0] -
                    at[0],

                  point[1] -
                    at[1]
                ) <
                radius
            );

          if (hit) {
            redo.push({
              kind:
                "stroke",

              item:
                stroke,
            });

            changed = true;
          }

          return !hit;
        }
      );

    if (!changed) {
      return;
    }

    renderCanvas();

    localSave();
  }

  /*
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
          (minX +
            maxX) /
            2,

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

        x: minX,
        y: minY,

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
      ) / points.length;

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

        finished = true;

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

      /*
       * Even if browser fullscreen is unavailable,
       * CSS Focus Mode still works.
       */

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

      /*
       * fullscreenchange will update UI.
       */
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

          /*
           * Save initial gesture state.
           */

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
         * Do nothing.
         *
         * Apple Pencil can leave the CSS
         * bounds for a tiny moment while
         * pointer capture remains active.
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
     * Fullscreen state from browser.
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
    /*
     * If the browser exited fullscreen
     * using its own UI, synchronize our
     * Focus Mode state.
     */

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