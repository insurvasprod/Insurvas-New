/* Settings round 8 board kit: option (A/B/C) and theme switching. Keys 1–3 pick an option, L / D the theme.
   Buttons: <button data-opt="A">, <button data-theme="light">. The body carries class light|dark and data-opt. */
(function () {
  var body = document.body;
  if (!body.dataset.opt) body.dataset.opt = "A";
  if (!/\b(light|dark)\b/.test(body.className)) body.classList.add("light");
  function sync() {
    document.querySelectorAll("[data-opt-btn]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.optBtn === body.dataset.opt)); });
    document.querySelectorAll("[data-theme-btn]").forEach(function (b) { b.setAttribute("aria-pressed", String(body.classList.contains(b.dataset.themeBtn))); });
  }
  function opt(v) { body.dataset.opt = v; sync(); }
  function theme(v) { body.classList.remove("light", "dark"); body.classList.add(v); sync(); }
  document.querySelectorAll("[data-opt-btn]").forEach(function (b) { b.addEventListener("click", function () { opt(b.dataset.optBtn); }); });
  document.querySelectorAll("[data-theme-btn]").forEach(function (b) { b.addEventListener("click", function () { theme(b.dataset.themeBtn); }); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "1") opt("A"); if (e.key === "2") opt("B"); if (e.key === "3") opt("C");
    if (e.key === "l" || e.key === "L") theme("light"); if (e.key === "d" || e.key === "D") theme("dark");
  });
  sync();
})();
