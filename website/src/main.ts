const features = document.querySelectorAll<HTMLElement>(".feature-list li");

if (features.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.2, rootMargin: "0px 0px -40px 0px" },
  );
  features.forEach((el, i) => {
    el.style.transitionDelay = `${i * 60}ms`;
    io.observe(el);
  });
} else {
  features.forEach((el) => el.classList.add("is-in"));
}
