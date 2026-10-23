#!/usr/bin/env python3
"""Builds the feature pages, and the top bar on every page.

Each feature's text is in _src/pages/<slug>.html: a front matter comment (title,
lede, description), then the body. Run `python3 _src/build.py` from the site's
root after editing one; it writes features/<slug>.html and features/index.html,
and puts the same top bar (with the Features menu) into index.html.
"""
import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ROOT / '_src' / 'pages'

GROUPS = [
    ('Writing', [
        ('editor', 'The editor', 'VS Code’s editor, set up for chapters: search the book, Contents, typing that wraps a selection.'),
        ('preview', 'Live preview', 'The typeset pages beside the text, redrawn from what you’ve typed, saved or not.'),
        ('templates', 'Templates and samples', 'Novels, textbooks, picture books and papers, at the sizes printers use.'),
    ]),
    ('The assistant', [
        ('assistant', 'The assistant', 'It edits the book itself and says what it did, in the book’s terms.'),
        ('permissions', 'Permissions', 'Each command explained before it runs. Each “always” is a rule you can read and remove.'),
        ('style-guide', 'Style guide', 'One file of rules that every request follows, written with you.'),
        ('comments', 'Comments and Fix all', 'Mark a chapter up like an editor, then hand every comment over at once.'),
        ('assistants', 'Choosing an assistant', 'Claude Code, Codex, OpenCode, Gemini CLI or Antigravity, on your own account.'),
    ]),
    ('Keeping your work', [
        ('history', 'History', 'Every version, kept outside the book, with what changed word by word.'),
    ]),
    ('Publishing', [
        ('printing', 'Printing and covers', 'A PDF for the printer, and a cover with the spine worked out from the page count.'),
        ('ebooks', 'E-books', 'An EPUB that reflows, or one with every page as typeset.'),
        ('code', 'Code that runs', 'Examples run from the book, with their real output set beneath.'),
    ]),
]
ORDER = [f for _, items in GROUPS for f in items]
GROUP_OF = {slug: g for g, items in GROUPS for slug, _, _ in items}

ICONS = {
    'editor': '<path d="M4 5.5h16M4 10h10M4 14.5h16M4 19h8"/>',
    'preview': '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 7.5h7M8.5 10.5h7M8.5 13.5h4"/>',
    'templates': '<rect x="3.5" y="4" width="7" height="9" rx="1"/><rect x="13.5" y="4" width="7" height="6" rx="1"/><rect x="13.5" y="13" width="7" height="7" rx="1"/><rect x="3.5" y="16" width="7" height="4" rx="1"/>',
    'assistant': '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1-5.1-1.9 5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    'permissions': '<path d="M12 3.5l7 2.8v5.2c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6.3z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    'style-guide': '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h12v-4M9 8h6M9 11h4"/>',
    'comments': '<path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z"/><path d="M8 9.5h8M8 12.5h5"/>',
    'assistants': '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    'history': '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4.5v3.8h3.8M12 8v4.3l3 1.8"/>',
    'printing': '<path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v3h3M9 11h6M9 14h6M9 17h3"/>',
    'ebooks': '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7.5h6M9 10.5h6M9 13.5h4M11 18h2"/>',
    'code': '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5"/>',
}

DOWNLOAD = 'https://github.com/jgeewax/foreword/releases/latest/download/Foreword_aarch64.dmg'
APPLE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.27 1.86-3.36 1.94-3.41-1.06-1.55-2.7-1.76-3.28-1.78-1.4-.14-2.73.82-3.44.82-.71 0-1.8-.8-2.96-.78-1.52.02-2.93.89-3.71 2.25-1.59 2.75-.41 6.81 1.13 9.04.75 1.09 1.65 2.31 2.82 2.27 1.13-.05 1.56-.73 2.93-.73 1.37 0 1.75.73 2.95.71 1.22-.02 1.99-1.11 2.73-2.2.86-1.26 1.21-2.48 1.23-2.55-.03-.01-2.36-.9-2.34-3.64zM14.12 5.94c.62-.76 1.04-1.8.93-2.85-.9.04-1.99.6-2.63 1.35-.58.66-1.08 1.73-.95 2.75 1 .08 2.03-.51 2.65-1.25z"/></svg>'
CHEVRON = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>'


def icon(slug):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[slug]}</svg>'


def top_bar(prefix, current=None):
    """The top bar: name, Features menu, GitHub, Download. `prefix` reaches the site's root."""
    cols = [[GROUPS[0], GROUPS[2]], [GROUPS[1]], [GROUPS[3]]]
    panel = []
    for col in cols:
        panel.append('<div>')
        for name, items in col:
            panel.append(f'<h4>{name}</h4>')
            for slug, title, blurb in items:
                cur = ' aria-current="page"' if slug == current else ''
                panel.append(f'<a href="{prefix}features/{slug}.html"{cur}><b>{title}</b><span>{blurb}</span></a>')
        if col is cols[-1]:
            panel.append(f'<a class="all" href="{prefix}features/">All features →</a>')
        panel.append('</div>')
    feat_cur = ' aria-current="true"' if current else ''
    return f'''<header class="top">
  <div class="wrap">
    <a class="brand" href="{prefix or './'}"><img src="{prefix}images/icon.png" alt="" width="30" height="30">Foreword</a>
    <nav class="links">
      <div class="menu">
        <button class="menu-toggle" type="button" aria-expanded="false"{feat_cur}>Features {CHEVRON}</button>
        <div class="menu-panel">
          {"".join(panel)}
        </div>
      </div>
      <a href="https://github.com/jgeewax/foreword">GitHub</a>
      <a class="button small" data-download href="{DOWNLOAD}">Download</a>
    </nav>
  </div>
</header>'''


def footer(prefix):
    return f'''<footer>
  <div class="wrap">
    <a class="brand" href="{prefix or './'}"><img src="{prefix}images/icon.png" alt="" width="24" height="24">Foreword</a>
    <span>Made by JJ Geewax in Singapore</span>
    <nav>
      <a href="{prefix}features/">Features</a>
      <a href="https://github.com/jgeewax/foreword/releases">Releases</a>
      <a href="https://github.com/jgeewax/foreword">GitHub</a>
      <a href="https://typst.app">Typst</a>
    </nav>
    <p class="made">Foreword (called Typst Studio up to 0.3) is an independent project. It isn't made by, or affiliated with, the Typst team.</p>
  </div>
</footer>'''


def head(title, description, prefix, image='images/calculus.webp'):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:image" content="https://jgeewax.github.io/foreword/{image}">
<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0e17" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" href="{prefix}images/favicon.png">
<link rel="apple-touch-icon" href="{prefix}images/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{prefix}assets/site.css">
</head>
<body>
'''


def read_page(slug):
    text = (PAGES / f'{slug}.html').read_text()
    m = re.match(r'\s*<!--(.*?)-->\s*', text, re.S)
    meta = {}
    for line in m.group(1).strip().splitlines():
        k, _, v = line.partition(':')
        meta[k.strip()] = v.strip()
    return meta, text[m.end():]


def webp_size(path):
    """A WebP file's width and height, from its header."""
    d = path.read_bytes()[:40]
    kind = d[12:16]
    if kind == b'VP8X':
        return 1 + int.from_bytes(d[24:27], 'little'), 1 + int.from_bytes(d[27:30], 'little')
    if kind == b'VP8 ':
        return int.from_bytes(d[26:28], 'little') & 0x3fff, int.from_bytes(d[28:30], 'little') & 0x3fff
    b = int.from_bytes(d[21:25], 'little')
    return (b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1


def real_sizes(body):
    """Give each picture the width and height of its file, so the page doesn't jump as it loads."""
    def fix(m):
        f = ROOT / m.group(1)
        if not f.exists():
            print('  missing', m.group(1))
            return m.group(0)
        w, h = webp_size(f)
        return f'src="../{m.group(1)}" width="{w}" height="{h}"'
    return re.sub(r'src="\.\./(images/[^"]+\.webp)" width="\d+" height="\d+"', fix, body)


def build_page(i, slug, title):
    meta, body = read_page(slug)
    body = real_sizes(body)
    # Each section heading gets an anchor, from its words.
    body = re.sub(r'<h2>(.*?)</h2>', lambda m: f'<h2 id="{re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", m.group(1)).lower()).strip("-")}">{m.group(1)}</h2>', body)
    prev_ = ORDER[i - 1] if i > 0 else None
    next_ = ORDER[i + 1] if i + 1 < len(ORDER) else None
    nav = []
    nav.append(f'<a href="{prev_[0]}.html"><small>← Previous</small><b>{prev_[1]}</b></a>' if prev_ else f'<a href="./"><small>← All features</small><b>Features</b></a>')
    nav.append(f'<a class="next" href="{next_[0]}.html"><small>Next →</small><b>{next_[1]}</b></a>' if next_ else f'<a class="next" href="./"><small>All features →</small><b>Features</b></a>')
    page = head(f'{meta.get("title", title)} · Foreword', meta['description'], '../', meta.get('image', 'images/calculus.webp'))
    page += top_bar('../', slug)
    page += f'''
<main class="wrap">
  <div class="doc-head">
    <div class="crumbs"><a href="./">Features</a><span>{GROUP_OF[slug]}</span></div>
    <h1>{meta.get("heading", title)}</h1>
    <p class="lede">{meta["lede"]}</p>
  </div>
  <article class="doc">
{body.rstrip()}
  </article>
  <nav class="doc-next">{"".join(nav)}</nav>
  <div class="doc-cta">
    <p><strong>Foreword is free, for Macs with Apple Silicon.</strong> <span data-version>Version 0.6.0</span>, macOS 13 or later. It carries Typst’s tools inside, and keeps itself up to date.</p>
    <a class="button" data-download href="{DOWNLOAD}">{APPLE} Download for Mac</a>
  </div>
</main>

{footer('../')}
<script src="../assets/site.js"></script>
</body>
</html>
'''
    (ROOT / 'features' / f'{slug}.html').write_text(page)


def build_index():
    page = head('Features · Foreword', 'What Foreword does, one feature to a page: how each works, step by step, and why it works that way.', '../')
    page += top_bar('../', 'index')
    page += '''
<main class="wrap">
  <div class="doc-head">
    <h1>Features</h1>
    <p class="lede">One page for each part of Foreword: what it does, step by step, why it works the way it does, and what it doesn’t do yet. The pictures are the app, as it is today.</p>
  </div>
'''
    for name, items in GROUPS:
        page += f'  <section class="group">\n    <span class="eyebrow">{name}</span>\n    <div class="grid">\n'
        for slug, title, blurb in items:
            page += f'      <a class="card" href="{slug}.html">{icon(slug)}<h3>{title}</h3><p>{blurb}</p></a>\n'
        page += '    </div>\n  </section>\n'
    page += f'''  <div class="doc-cta" style="margin-top: 90px">
    <p><strong>Foreword is free, for Macs with Apple Silicon.</strong> <span data-version>Version 0.6.0</span>, macOS 13 or later.</p>
    <a class="button" data-download href="{DOWNLOAD}">{APPLE} Download for Mac</a>
  </div>
</main>

{footer('../')}
<script src="../assets/site.js"></script>
</body>
</html>
'''
    (ROOT / 'features' / 'index.html').write_text(page)


def build_home():
    p = ROOT / 'index.html'
    s = p.read_text()
    s = re.sub(r'<style>.*?</style>', '<link rel="stylesheet" href="assets/site.css">', s, count=1, flags=re.S)
    s = re.sub(r'<header class="top">.*?</header>', lambda _: top_bar(''), s, count=1, flags=re.S)
    s = re.sub(r'<footer>.*?</footer>', lambda _: footer(''), s, count=1, flags=re.S)
    s = re.sub(r'<script>\s*// The newest release.*?</script>', '<script src="assets/site.js"></script>', s, count=1, flags=re.S)
    p.write_text(s)


if __name__ == '__main__':
    (ROOT / 'features').mkdir(exist_ok=True)
    for i, (slug, title, _) in enumerate(ORDER):
        if (PAGES / f'{slug}.html').exists():
            build_page(i, slug, title)
    build_index()
    build_home()
    print('built', sum(1 for s, _, _ in ORDER if (PAGES / f'{s}.html').exists()), 'feature pages')
