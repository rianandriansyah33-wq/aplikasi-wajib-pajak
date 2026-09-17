(function () {
  const menuButton = document.querySelector("#siteMenuBtn");
  const menuPanel = document.querySelector("#siteMenuPanel");

  if (!menuButton || !menuPanel) return;

  function closeMenu() {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  menuButton.addEventListener("click", function (event) {
    event.stopPropagation();
    const shouldOpen = menuPanel.hidden;
    menuPanel.hidden = !shouldOpen;
    menuButton.setAttribute("aria-expanded", String(shouldOpen));
  });

  menuPanel.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });
})();
