"use strict";

/*
  Application shell controller.

  Shell-ul persistent aparține documentului index.html. Fiecare funcționalitate
  integrată ulterior se poate înregistra ca view și poate furniza propriile
  hook-uri de intrare și ieșire, fără să recreeze sidebar-ul sau topbar-ul.
*/

(function initializeApplicationShell(global) {
  const views = new Map();
  const routes = new Map();

  let activeViewName = null;
  let activeRouteParams = {};
  let notFoundViewName = "home";

  function registerView(name, configuration) {
    if (!name || !configuration?.elementId) {
      throw new Error(
        "Un view Itera are nevoie de nume și de elementId."
      );
    }

    const view = {
      onEnter: null,
      onLeave: null,
      route: name === "home" ? "/" : `/${name}`,
      ...configuration
    };

    views.set(name, view);
    routes.set(normalizeRoute(view.route), name);
  }

  function hasView(name) {
    return views.has(name);
  }

  function getActiveView() {
    return activeViewName;
  }

  function normalizeRoute(route) {
    const normalized = String(route || "/")
      .replace(/^#/, "")
      .split("?")[0];

    if (!normalized || normalized === "/") {
      return "/";
    }

    return `/${normalized.replace(/^\/+|\/+$/g, "")}`;
  }

  function routeForView(name) {
    return normalizeRoute(views.get(name)?.route || "/");
  }

  function viewForRoute(route) {
    const normalized = normalizeRoute(route);
    const query = String(route || "").split("?")[1] || "";
    const queryParams = Object.fromEntries(new URLSearchParams(query));
    const exact = routes.get(normalized);

    if (exact) {
      return { name: exact, params: queryParams };
    }

    for (const [pattern, name] of routes) {
      if (!pattern.includes(":")) continue;
      const keys = [];
      const expression = new RegExp(
        `^${pattern.replace(/:([^/]+)/g, (_, key) => {
          keys.push(key);
          return "([^/]+)";
        })}$`
      );
      const match = normalized.match(expression);
      if (match) {
        return {
          name,
          params: {
            ...queryParams,
            ...Object.fromEntries(keys.map((key, index) => [
              key,
              decodeURIComponent(match[index + 1])
            ]))
          }
        };
      }
    }

    return { name: notFoundViewName, params: {} };
  }

  function navigate(name, options = {}) {
    const nextView = views.get(name);

    if (!nextView) {
      return false;
    }

    const currentView = views.get(activeViewName);

    if (
      activeViewName &&
      activeViewName !== name &&
      typeof currentView?.onLeave === "function"
    ) {
      currentView.onLeave();
    }

    document
      .querySelectorAll("[data-app-view]")
      .forEach((viewElement) => {
        viewElement.classList.toggle(
          "active-page",
          viewElement.id === nextView.elementId
        );
      });

    document
      .querySelectorAll("[data-page]")
      .forEach((navigationItem) => {
        navigationItem.classList.toggle(
          "active",
          navigationItem.dataset.page ===
            (nextView.navigationName || name)
        );
      });

    document
      .querySelectorAll("[data-route-group]")
      .forEach((navigationItem) => {
        const group = navigationItem.dataset.routeGroup.split(",");
        navigationItem.classList.toggle(
          "active",
          group.includes(name)
        );
      });

    activeViewName = name;

    if (
      typeof nextView.onEnter === "function"
    ) {
      nextView.onEnter({
        params: activeRouteParams
      });
    }

    window.scrollTo({
      top: 0,
      behavior: "auto"
    });

    if (options.updateUrl) {
      const nextHash = `#${routeForView(name)}`;

      if (global.location.hash !== nextHash) {
        global.history.pushState(
          {
            view: name
          },
          "",
          nextHash
        );
      }
    }

    return true;
  }

  function navigateToRoute(route, options = {}) {
    const match = viewForRoute(route);
    activeRouteParams = match.params;
    return navigate(match.name, options);
  }

  function start(options = {}) {
    notFoundViewName = options.notFoundView || "home";

    global.addEventListener("hashchange", () => {
      navigateToRoute(global.location.hash);
    });

    navigateToRoute(global.location.hash || "#/");
  }

  global.IteraShell = Object.freeze({
    registerView,
    hasView,
    getActiveView,
    navigate,
    navigateToRoute,
    routeForView,
    start
  });
})(window);
