const reveal = document.querySelectorAll<HTMLElement>(
  ".step, .hero-copy, .lamp-figure",
);

if (reveal.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -24px 0px" },
  );
  reveal.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i, 4) * 50}ms`;
    io.observe(el);
  });
} else {
  reveal.forEach((el) => el.classList.add("is-in"));
}

const row = document.querySelector(".cta-row");
const mac = document.querySelector<HTMLElement>('[data-platform="mac"]');
const win = document.querySelector<HTMLElement>('[data-platform="win"]');
if (row && mac && win) {
  const ua = navigator.userAgent;
  const isMac = /Mac|iPhone|iPad|iPod/.test(ua);
  const isWin = /Windows/.test(ua);
  if (isWin) {
    win.classList.add("btn-primary");
    win.classList.remove("btn-secondary");
    mac.classList.add("btn-secondary");
    mac.classList.remove("btn-primary");
    row.prepend(win);
  } else if (isMac) {
    row.prepend(mac);
  }
}
