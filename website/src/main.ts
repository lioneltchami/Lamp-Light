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

const FALLBACK = {
  macArm:
    "https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-arm64.dmg",
  macIntel:
    "https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-x64.dmg",
  win: "https://github.com/lioneltchami/Lamp-Light/releases/latest/download/Lamp-Light-Setup.exe",
} as const;

type Asset = { name: string; browser_download_url: string };

function preferIntelMac(): boolean {
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { architecture?: string };
    }
  ).userAgentData;
  if (uaData?.architecture === "x86") return true;
  if (uaData?.architecture === "arm") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && info) {
      const renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      if (/Apple/.test(renderer)) return false;
      if (/Intel|AMD|NVIDIA/i.test(renderer)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function pick(assets: Asset[], re: RegExp): string | undefined {
  return assets.find((a) => re.test(a.name))?.browser_download_url;
}

async function wireDirectDownloads(): Promise<void> {
  const mac = document.querySelector<HTMLAnchorElement>('[data-platform="mac"]');
  const macIntel = document.querySelector<HTMLAnchorElement>(
    '[data-platform="mac-intel"]',
  );
  const win = document.querySelector<HTMLAnchorElement>('[data-platform="win"]');
  if (!mac || !win) return;

  let armUrl = FALLBACK.macArm;
  let intelUrl = FALLBACK.macIntel;
  let winUrl = FALLBACK.win;

  try {
    const res = await fetch(
      "https://api.github.com/repos/lioneltchami/Lamp-Light/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (res.ok) {
      const data = (await res.json()) as { assets?: Asset[] };
      const assets = (data.assets ?? []).filter(
        (a) => !a.name.endsWith(".blockmap"),
      );
      armUrl =
        pick(assets, /^Lamp-Light(?:-[\d.]+)?-arm64\.dmg$/) ??
        pick(assets, /^Lamp-Light-arm64\.dmg$/) ??
        armUrl;
      intelUrl =
        pick(assets, /^Lamp-Light(?:-[\d.]+)?-x64\.dmg$/) ??
        pick(assets, /^Lamp-Light-x64\.dmg$/) ??
        intelUrl;
      winUrl =
        pick(assets, /^Lamp-Light-Setup(?:-[\d.]+)?\.exe$/) ?? winUrl;
    }
  } catch {
    /* keep fallbacks */
  }

  mac.href = preferIntelMac() ? intelUrl : armUrl;
  if (macIntel) macIntel.href = intelUrl;
  win.href = winUrl;
}

const row = document.querySelector(".cta-row");
const mac = document.querySelector<HTMLAnchorElement>('[data-platform="mac"]');
const win = document.querySelector<HTMLAnchorElement>('[data-platform="win"]');

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

void wireDirectDownloads();
