(function () {
  const topbar = document.querySelector(".topbar");
  const menuButton = document.querySelector("#siteMenuBtn");
  const menuPanel = document.querySelector("#siteMenuPanel");

  function closeMenu() {
    if (!menuButton || !menuPanel) return;
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  if (menuButton && menuPanel) {
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
  }

  if (!topbar) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  function setHeaderHidden(shouldHide) {
    topbar.classList.toggle("is-scroll-hidden", shouldHide);
  }

  function updateHeader() {
    ticking = false;
    if (document.body.classList.contains("modal-open")) {
      setHeaderHidden(false);
      lastScrollY = window.scrollY;
      return;
    }

    const currentY = Math.max(0, window.scrollY);
    const delta = currentY - lastScrollY;
    const menuOpen = menuPanel && !menuPanel.hidden;

    if (menuOpen || currentY < 60 || delta < -6) {
      setHeaderHidden(false);
    } else if (delta > 8 && currentY > 90) {
      closeMenu();
      setHeaderHidden(true);
    }

    lastScrollY = currentY;
  }

  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateHeader);
  }, { passive: true });

  window.addEventListener("resize", updateHeader);
})();
