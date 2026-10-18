// The commit graph beside Source Control's commits, as VS Code's Graph: each
// commit a dot in a lane, lines down to its parents. Commits come newest
// first, children before parents (`git log --topo-order`).

/** One row of the graph: its dot, and the lines through the row's top and bottom halves. */
export type GraphRow = {
  /** The dot's lane. */
  lane: number;
  /** [lane at the row's top edge, lane at its middle]. */
  top: [number, number][];
  /** [lane at the row's middle, lane at its bottom edge]. */
  bottom: [number, number][];
};

export function layoutGraph(commits: { hash: string; parents: string[] }[]): { rows: GraphRow[]; width: number } {
  // The commit each lane is waiting for (null: free).
  const lanes: (string | null)[] = [];
  let width = 1;
  const rows = commits.map((c): GraphRow => {
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    const free = () => {
      const i = lanes.indexOf(null);
      return i < 0 ? lanes.length : i;
    };
    // A branch's newest commit starts a lane; otherwise the lanes waiting for it join here.
    let lane = lanes.indexOf(c.hash);
    if (lane < 0) lane = free();
    lanes.forEach((h, j) => {
      if (h === c.hash) {
        top.push([j, lane]);
        lanes[j] = null;
      } else if (h !== null) {
        top.push([j, j]);
        bottom.push([j, j]);
      }
    });
    const [first, ...others] = c.parents;
    lanes[lane] = first ?? null;
    if (first) bottom.push([lane, lane]);
    // A merge: a line to each other parent's lane (a new one if nothing waits for it yet).
    for (const p of others) {
      let k = lanes.indexOf(p);
      if (k < 0) lanes[(k = free())] = p;
      bottom.push([lane, k]);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, lane + 1, lanes.length, ...top.map(([j]) => j + 1));
    return { lane, top, bottom };
  });
  return { rows, width };
}
