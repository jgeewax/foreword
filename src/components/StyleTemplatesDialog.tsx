import { useEffect, useMemo, useState } from 'react';
import { studio } from '../app/studio';
import { useStore } from '../lib/store';
import { SAMPLES } from '../samples';
import { STYLE_TEMPLATES, suggestedStyleTemplate } from '../style-guides';
import { Markdown } from './Markdown';

/** Each sample's own guide: the worked example of its template, shown beside it. */
const SAMPLE_GUIDES = import.meta.glob('/samples/*/WRITING_STYLE.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A guide as the preview shows it: without its notes to the author (HTML comments). */
const readable = (text: string) => text.replace(/<!--[\s\S]*?-->\n*/g, '');

/**
 * Writing Style Guide Templates: one for each kind of book the samples are,
 * plus Blank. The preview shows the template, or the guide its sample has (a
 * real book written that way); Use this template writes WRITING_STYLE.md.
 */
export function StyleTemplatesDialog() {
  const files = useStore(studio.store, (s) => s.workspace?.files ?? []);
  const exists = useStore(studio.store, (s) => s.styleGuide.exists);
  const [id, setId] = useState(() => suggestedStyleTemplate(files));
  const [view, setView] = useState<'template' | 'sample'>('template');
  const [busy, setBusy] = useState(false);
  const template = STYLE_TEMPLATES.find((t) => t.id === id) ?? STYLE_TEMPLATES[0];
  const sample = SAMPLES.find((s) => s.id === template.sample);
  const sampleGuide = sample ? SAMPLE_GUIDES[`/samples/${sample.id}/WRITING_STYLE.md`] : undefined;
  const shown = useMemo(() => readable(view === 'sample' && sampleGuide ? sampleGuide : template.text('Your book')), [view, sampleGuide, template]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && studio.closeStyleTemplates();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  useEffect(() => setView('template'), [id]);

  const use = async () => {
    setBusy(true);
    try {
      await studio.createStyleGuideFromTemplate(template.id);
    } finally {
      setBusy(false);
    }
  };
  const openSample = async () => {
    if (!sample) return;
    const ok = await studio.confirmAction(
      `This window opens your own copy of the “${sample.name}” sample, to see its guide in a real book. Your book stays as it is: open it again with Open Recent in the command palette (⇧⌘P).`,
      `Open the ${sample.name.replace(/^The /, '')} sample?`,
      'Open the Sample',
    );
    if (!ok) return;
    studio.closeStyleTemplates();
    await studio.openSample(sample.id);
    await studio.openFile('WRITING_STYLE.md').catch(() => {});
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && studio.closeStyleTemplates()}>
      <div className="modal style-templates" role="dialog" aria-label="Writing style guide templates">
        <div className="modal-header">
          <h1>Start the style guide from a template</h1>
          <span className="spacer" />
          <button className="icon modal-close" aria-label="Close" onClick={() => studio.closeStyleTemplates()}>
            ✕
          </button>
        </div>
        <div className="modal-body style-templates-body">
          <div className="style-template-list" role="radiogroup" aria-label="Templates">
            {STYLE_TEMPLATES.map((t) => {
              const s = SAMPLES.find((x) => x.id === t.sample);
              return (
                <button key={t.id} type="button" role="radio" aria-checked={t.id === id} className={`template-card style-template${t.id === id ? ' selected' : ''}`} onClick={() => setId(t.id)}>
                  <span className="template-name">{t.name}</span>
                  <span className="template-description">{t.description}</span>
                  {s && <span className="template-details">Example: the {s.name.replace(/^The /, '')} sample</span>}
                </button>
              );
            })}
          </div>
          <div className="style-template-preview">
            <div className="kind-switch preview-switch" role="tablist">
              <button role="tab" aria-selected={view === 'template'} className={view === 'template' ? 'active' : ''} onClick={() => setView('template')}>
                The template
              </button>
              {sample && sampleGuide && (
                <button role="tab" aria-selected={view === 'sample'} className={view === 'sample' ? 'active' : ''} title="The guide the sample book has: this template, filled in for a real book" onClick={() => setView('sample')}>
                  In the sample
                </button>
              )}
            </div>
            <div className="style-template-text md" key={`${id}-${view}`}>
              <Markdown text={shown} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {sample && (
            <button className="link" disabled={busy} title="Open the sample book in this window, with its guide" onClick={() => void openSample()}>
              Open the {sample.name.replace(/^The /, '')} sample…
            </button>
          )}
          <span className="spacer" />
          <button disabled={busy} onClick={() => studio.closeStyleTemplates()}>
            Cancel
          </button>
          <button className="primary" disabled={busy} title={exists ? 'Replaces WRITING_STYLE.md (History keeps the one you have)' : 'Writes WRITING_STYLE.md, named for your book, and opens it'} onClick={() => void use()}>
            {exists ? 'Replace my guide with it' : 'Use this template'}
          </button>
        </div>
      </div>
    </div>
  );
}
