// About Foreword (the app menu's first item): its icon, name and version,
// who made it, and where it lives.
import { useEffect } from 'react';
import { studio } from '../app/studio';
import { ipc } from '../lib/ipc';
import { useStore } from '../lib/store';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { Icon } from './icons';

const SITE = 'https://jgeewax.github.io/foreword/';
const SOURCE = 'https://github.com/jgeewax/foreword';

export function AboutDialog() {
  const update = useStore(studio.store, (s) => s.update);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        studio.closeAbout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const version = update?.current ?? '';
  const status =
    update?.status === 'available' || update?.status === 'downloaded'
      ? `${update.version} is available`
      : update?.status === 'none'
        ? 'Up to date'
        : null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && studio.closeAbout()}>
      <div className="modal about-dialog" role="dialog" aria-modal="true" aria-label="About Foreword">
        <button className="icon modal-close about-close" aria-label="Close" title="Close (Esc)" onClick={() => studio.closeAbout()}>
          <Icon name="close" size={14} />
        </button>
        <img className="about-icon" src={appIcon} alt="" width={112} height={112} />
        <h1>Foreword</h1>
        <p className="about-version">
          Version {version}
          {status && <span className={`about-status${update?.status === 'none' ? '' : ' new'}`}>{status}</span>}
        </p>
        <p className="about-made">Made by JJ Geewax in Singapore</p>
        <div className="about-links">
          <button className="link" onClick={() => void ipc.openUrl(SITE)}>
            Website
          </button>
          <span aria-hidden>·</span>
          <button className="link" onClick={() => void ipc.openUrl(SOURCE)}>
            Source on GitHub
          </button>
          <span aria-hidden>·</span>
          <button
            className="link"
            onClick={() => {
              studio.closeAbout();
              void studio.checkForUpdates({ dialog: true });
            }}
          >
            Check for Updates
          </button>
        </div>
        <p className="about-fine">
          Typeset with Typst, through Tinymist. Not made by, or affiliated with, the Typst team.
          <br />© 2026 JJ Geewax
        </p>
      </div>
    </div>
  );
}
