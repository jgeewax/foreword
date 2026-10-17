import { studio } from '../app/studio';
import { GUIDE } from '../help/guide';
import { useStore } from '../lib/store';

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => studio.toast('Copied'),
    (e) => studio.toast(`Couldn't copy: ${e}`, 'error'),
  );
}

/** "Typst basics" for writers: plain-language explanations with examples. */
export function TypstGuide({ onClose }: { onClose: () => void }) {
  const canInsert = useStore(studio.store, (s) => !!s.active && !!s.workspace);
  return (
    <div className="guide">
      <div className="guide-header">
        <strong>Typst basics</strong>
        <span className="spacer" />
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="guide-body">
        <p className="guide-intro">
          Your book is plain text with a little markup. You write; the preview shows the typeset pages as you type. These are the pieces you'll use most.
        </p>
        {GUIDE.sections.map((section) => (
          <section key={section.title} className="guide-section">
            <h2>{section.title}</h2>
            {section.items.map((item) => (
              <div key={item.title} className="guide-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {item.code && (
                  <div className="guide-example">
                    <pre>{item.code}</pre>
                    <div className="guide-actions">
                      {item.insert && (
                        <button disabled={!canInsert} title={canInsert ? 'Insert at the cursor (⌘Z to undo)' : 'Open a chapter first'} onClick={() => studio.insertSnippet(item.code!)}>
                          Insert
                        </button>
                      )}
                      <button onClick={() => copy(item.code!)}>Copy</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
        <section className="guide-section">
          <h2>Keyboard</h2>
          <table className="guide-keys">
            <tbody>
              {GUIDE.shortcuts.map(([keys, what]) => (
                <tr key={keys}>
                  <td>
                    <kbd>{keys}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="guide-more muted">
          The full reference is at <span className="selectable">typst.app/docs</span>. Or just ask the assistant.
        </p>
      </div>
    </div>
  );
}
