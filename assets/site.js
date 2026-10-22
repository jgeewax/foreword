// The Features menu: hover opens it on a desktop; a click (or tap) opens and closes it anywhere.
document.querySelectorAll('.menu').forEach((menu) => {
  const toggle = menu.querySelector('.menu-toggle');
  const set = (open) => {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    set(!menu.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
});

// The newest release: its version, its DMG's size, and a direct link to it.
fetch('https://api.github.com/repos/jgeewax/foreword/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((release) => {
    if (!release) return;
    const version = release.tag_name.replace(/^v/, '');
    const dmg = (release.assets || []).find((a) => a.name.endsWith('.dmg'));
    document.querySelectorAll('[data-version]').forEach((e) => (e.textContent = `Version ${version}`));
    if (dmg) {
      document.querySelectorAll('[data-download]').forEach((a) => (a.href = dmg.browser_download_url));
      document.querySelectorAll('[data-size]').forEach((e) => (e.textContent = `Free · ${Math.round(dmg.size / 1e6)} MB`));
    }
  })
  .catch(() => {});
