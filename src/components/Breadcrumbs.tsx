// The path bar under the tabs, as VS Code's breadcrumbs: the file's folders,
// the file, then the headings the cursor is under. Each opens a menu of what's
// beside it: a folder's files (its folders as submenus), or the file's outline.
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import { studio } from '../app/studio';
import { headingPath, type Heading } from '../editor/outline';
import { showContextMenu, type MenuEntry } from '../lib/context-menu';
import { useStore } from '../lib/store';
import { buildTree, type Node } from '../lib/tree';
import { FileIcon, Icon } from './icons';

/** A folder's contents as a menu: files open, folders are submenus; the open file ticked. */
function folderMenu(nodes: Node[], current: string): MenuEntry[] {
  return nodes.map((n) =>
    n.dir ? { label: n.name, items: folderMenu(n.children, current) } : { label: n.name, checked: n.path === current, action: () => void studio.openFile(n.path) },
  );
}

/** What's in a folder ('' is the book's own). */
function contents(tree: Node[], folder: string): Node[] {
  let nodes = tree;
  for (const name of folder ? folder.split('/') : []) nodes = nodes.find((n) => n.dir && n.name === name)?.children ?? [];
  return nodes;
}

const Chevron = () => (
  <span className="crumb-sep" aria-hidden>
    <Icon name="chevronRight" size={14} />
  </span>
);

export function Breadcrumbs({ path, outline }: { path: string; outline: Heading[] }) {
  const files = useStore(studio.store, (s) => s.workspace?.files);
  const line = useStore(studio.store, (s) => s.cursor?.line ?? 1);
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const parts = path.split('/');
  const under = headingPath(outline, line);
  const ref = useRef<HTMLElement>(null);
  const last = under.at(-1)?.line;
  // Too long for the pane: it scrolls, and shows its end (where the cursor is).
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [path, last]);

  const beside = (i: number) => () => void showContextMenu(folderMenu(contents(tree, parts.slice(0, i).join('/')), path));
  const outlineMenu = (h: Heading) => () =>
    void showContextMenu(outline.map((o) => ({ label: `${' '.repeat(o.level - 1)}${o.title}`, checked: o === h, action: () => void studio.openAt(path, o.line) })));

  return (
    <nav className="breadcrumbs" aria-label="Path" ref={ref}>
      {parts.map((name, i) => (
        <Fragment key={i}>
          {i > 0 && <Chevron />}
          <button className="crumb" title={parts.slice(0, i + 1).join('/')} onClick={beside(i)}>
            {i === parts.length - 1 && <FileIcon path={path} />}
            {name}
          </button>
        </Fragment>
      ))}
      {under.map((h) => (
        <Fragment key={h.line}>
          <Chevron />
          <button className="crumb" title={`${h.title} (line ${h.line})`} onClick={outlineMenu(h)}>
            <span className="crumb-heading">
              <Icon name="heading" size={14} />
            </span>
            {h.title}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
