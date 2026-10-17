export type Node = { name: string; path: string; dir: boolean; children: Node[] };

export function buildTree(files: string[]): Node[] {
  const root: Node = { name: '', path: '', dir: true, children: [] };
  for (const file of files) {
    const parts = file.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      const dir = i < parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.dir === dir);
      if (!child) {
        child = { name: part, path, dir, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}
