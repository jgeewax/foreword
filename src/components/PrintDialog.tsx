import { useEffect, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { coverSpinePt, MIXAM_PRODUCTS, MIXAM_SITES, mixamSiteFor, mixamUrl, ptToIn, ptToMm, readyToPrint, type Check, type MixamProduct, type MixamSite } from '../print';

const SITE_KEY = 'studio.mixamSite';
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const ICON: Record<Check['level'], string> = { ok: '✓', warn: '!', bad: '✕', info: 'i' };
const ACTION_LABEL: Record<NonNullable<Check['action']>, string> = {
  'design-cover': 'Design a cover…',
  'update-cover': 'Update cover from book',
  'run-code': 'Run code examples',
  'show-problems': 'Show the first error',
};

/** Print with Mixam: make and check the print files, then order on Mixam's site. */
export function PrintDialog() {
  const print = useStore(studio.store, (s) => s.print);
  const [site, setSite] = useState<MixamSite>(() => {
    const saved = stored(SITE_KEY);
    return MIXAM_SITES.some((s) => s.id === saved) ? (saved as MixamSite) : mixamSiteFor(navigator.language);
  });
  const [product, setProduct] = useState<MixamProduct>('novels');
  const [spine, setSpine] = useState('');
  const working = print.status === 'working';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && studio.closePrint();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chooseSite = (id: MixamSite) => {
    setSite(id);
    try {
      localStorage.setItem(SITE_KEY, id);
    } catch {
      // Only a convenience.
    }
  };
  const open = (path: string) => void studio.openPrinterPage(mixamUrl(site, path));

  const facts = print.facts;
  const interior = facts?.interior;
  const finished = interior?.trim ? [interior.trim[2], interior.trim[3]] : null;
  const metric = MIXAM_SITES.find((s) => s.id === site)!.units === 'mm';
  const size = finished ? (metric ? `${ptToMm(finished[0])} × ${ptToMm(finished[1])} mm` : `${ptToIn(finished[0])} × ${ptToIn(finished[1])} in`) : null;
  const ourSpine = facts?.cover ? coverSpinePt(facts.cover.spec) : null;
  const ready = print.status === 'done' && readyToPrint(print.checks);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closePrint()}>
      <div className="modal new-book print-dialog" role="dialog" aria-label="Print with Mixam">
        <div className="modal-header">
          <h1>Print with Mixam</h1>
          <span className="spacer" />
          <button type="button" className="icon" aria-label="Close" onClick={() => studio.closePrint()}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="settings-help">
            Foreword makes the print files and checks them. You order on Mixam’s website: choose the size, paper and binding there, see the price, and upload the
            files. Nothing is ordered or paid from Foreword.
          </p>
          {working ? (
            <p className="muted">Making the print files…</p>
          ) : (
            <ul className="print-checks" aria-label="Checks">
              {print.checks.map((c, i) => (
                <li key={i} className={`check-${c.level}`}>
                  <span className="check-icon" aria-hidden>
                    {ICON[c.level]}
                  </span>
                  <span className="check-text">
                    {c.text}
                    {c.action && (
                      <button type="button" className="small" onClick={() => void studio.printAction(c.action!)}>
                        {ACTION_LABEL[c.action]}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!working && (print.files.interior || print.files.cover) && (
            <div className="field">
              <span>Files to upload</span>
              {print.files.interior && (
                <div className="field-row">
                  <span className="print-file-kind">Interior</span>
                  <code className="path">{print.files.interior}</code>
                  <button type="button" className="small" onClick={() => void studio.reveal(print.files.interior!)}>
                    Show in Finder
                  </button>
                </div>
              )}
              {print.files.cover && (
                <div className="field-row">
                  <span className="print-file-kind">Cover</span>
                  <code className="path">{print.files.cover}</code>
                  <button type="button" className="small" onClick={() => void studio.reveal(print.files.cover!)}>
                    Show in Finder
                  </button>
                </div>
              )}
            </div>
          )}
          {!working && interior && (
            <div className="field">
              <span>On Mixam, choose</span>
              <span className="field-note print-spec">
                Size: <strong>{size}</strong> (a custom size if it isn’t listed) · Pages: <strong>{interior.pages}</strong> (the interior; the cover is separate) ·
                Binding: <strong>{interior.pages >= 32 ? 'perfect bound (paperback)' : 'saddle stitched (stapled)'}</strong>
              </span>
              {product === 'hardcoverbooks' && (
                <span className="field-note bad">
                  A hardcover’s cover wraps around boards: Mixam asks for 0.8in (20mm) bleed on it. This cover is set up for a paperback, so make the hardcover’s cover
                  with Mixam’s template.
                </span>
              )}
            </div>
          )}
          {!working && facts?.cover && (
            <div className="field">
              <span>Spine width from Mixam</span>
              <div className="field-row">
                <input aria-label="Spine width" placeholder={ourSpine != null ? `now ${ptToMm(ourSpine)}mm` : 'e.g. 15.2mm'} value={spine} onChange={(e) => setSpine(e.target.value)} />
                <button type="button" className="small" disabled={!spine.trim()} onClick={() => void studio.setCoverSpine(spine)}>
                  Use this width
                </button>
              </div>
              <span className="field-note">Mixam shows the spine for your paper and page count. Enter it here and the cover is made again to match.</span>
            </div>
          )}
          <div className="field">
            <span>Mixam</span>
            <div className="field-row">
              <select aria-label="Mixam site" value={site} onChange={(e) => chooseSite(e.target.value as MixamSite)}>
                {MIXAM_SITES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select aria-label="Product" value={product} onChange={(e) => setProduct(e.target.value as MixamProduct)}>
                {MIXAM_PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button type="button" className="link" onClick={() => open('support/filesetup')}>
                File setup guide
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" disabled={working} onClick={() => void studio.preparePrint()}>
            Make the files again
          </button>
          <span className="spacer" />
          <button type="button" onClick={() => studio.closePrint()}>
            Close
          </button>
          <button
            type="button"
            className="primary"
            disabled={working || !print.files.interior}
            title={ready ? undefined : 'Some checks failed: you can still look at Mixam, but fix them before uploading.'}
            onClick={() => open(product)}
          >
            Open Mixam ↗
          </button>
        </div>
      </div>
    </div>
  );
}
