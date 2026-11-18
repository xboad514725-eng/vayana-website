/* VAYANA visitor theme controller — does not load on admin.html */
(() => {
  const KEY = "vayana-theme";
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function getSavedTheme(){
    try {
      const value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (_) { return null; }
  }

  function applyTheme(theme){
    root.dataset.vayanaTheme = theme;
    const button = document.querySelector("[data-vayana-theme-toggle]");
    if(button){
      const dark = theme === "dark";
      button.textContent = dark ? "☀" : "☾";
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("aria-pressed", String(dark));
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content", theme === "dark" ? "#10151b" : "#ffffff");
  }

  const initial = getSavedTheme() || (media && media.matches ? "dark" : "light");
  applyTheme(initial);

  function init(){
    const button = document.querySelector("[data-vayana-theme-toggle]");
    if(button && !button.dataset.bound){
      button.dataset.bound = "true";
      button.addEventListener("click", () => {
        const next = root.dataset.vayanaTheme === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, next); } catch (_) {}
        applyTheme(next);
      });
      applyTheme(root.dataset.vayanaTheme || initial);
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else { init(); }

  if(media){
    const onSystemChange = event => {
      if(!getSavedTheme()) applyTheme(event.matches ? "dark" : "light");
    };
    if(media.addEventListener) media.addEventListener("change", onSystemChange);
    else if(media.addListener) media.addListener(onSystemChange);
  }

  window.addEventListener("storage", event => {
    if(event.key === KEY) applyTheme(getSavedTheme() || (media && media.matches ? "dark" : "light"));
  });
})();