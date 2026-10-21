document
  .querySelector(".search-toggle")
  ?.addEventListener("click", function () {
    const d = document.querySelector(".search-drawer");
    d.hidden = !d.hidden;
    this.setAttribute("aria-expanded", String(!d.hidden));
    if (!d.hidden) d.querySelector("input").focus();
  });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const d = document.querySelector(".search-drawer");
    if (d) {
      d.hidden = true;
      document
        .querySelector(".search-toggle")
        ?.setAttribute("aria-expanded", "false");
    }
  }
});
