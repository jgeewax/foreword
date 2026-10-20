// Foreword's updates, as iTerm2's: a dialog that offers a new version
// (what's new; skip it, install when you quit, or install now), then shows its
// download, its install and the restart. Settings ▸ General ▸ Updates uses the
// same progress and buttons.
import { useEffect, useRef } from 'react';
import { studio } from '../app/studio';
import type { UpdateState } from '../lib/ipc';
import { ipc } from '../lib/ipc';
import { useStore } from '../lib/store';
import appIcon from '../../src-tauri/icons/128x128@2x.png';
import { Icon } from './icons';
import { Markdown } from './Markdown';

export const RELEASES = 'https://github.com/jgeewax/foreword/releases';

export const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 10e6 ? 1 : 0)} MB`;

const seconds = (s: number) => (s < 60 ? `about ${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`);

/** The download: a bar, how much of how much, how fast, and how long to go. */
export function DownloadProgress({ update }: { update: UpdateState }) {
  // The speed over the last few seconds, from the progress events.
  const samples = useRef<{ t: number; r: number }[]>([]);
  const now = performance.now();
  const last = samples.current[samples.current.length - 1];
  if (!last || last.r !== update.received) samples.current = [...samples.current.filter((s) => now - s.t < 3000 && s.r <= update.received), { t: now, r: update.received }];
  const first = samples.current[0];
  const span = (now - first.t) / 1000;
  const speed = span > 0.5 ? (update.received - first.r) / span : 0;
  const total = update.total ?? 0;
  const pct = total ? Math.min(100, (update.received / total) * 100) : 0;
  const left = speed > 0 && total ? (total - update.received) / speed : null;
  return (
    <div className="update-progress">
      <div className="update-bar" role="progressbar" aria-label="Downloading the update" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span className={total ? '' : 'indeterminate'} style={total ? { width: `${pct}%` } : undefined} />
      </div>
      <div className="update-figures">
        <span>
          {megabytes(update.received)}
          {total ? ` of ${megabytes(total)}` : ''}
        </span>
        {speed > 0 && <span>{megabytes(speed)}/s</span>}
        {left !== null && <span>{seconds(left)}</span>}
      </div>
    </div>
  );
}

/** Installing: each step, done, at work (a moving bar) or to come. */
export function InstallSteps({ update }: { update: UpdateState }) {
  const order = ['verifying', 'installing', 'restarting'] as const;
  const at = update.status === 'restarting' ? 2 : Math.max(0, order.indexOf(update.phase ?? 'verifying'));
  const steps = [
    { label: `Downloaded${update.total ? `, ${megabytes(update.total)}` : ''}`, state: 'done' },
    ...order.map((p, i) => ({
      label: { verifying: 'Checking its signature', installing: 'Replacing the app', restarting: 'Restarting' }[p],
      state: i < at ? 'done' : i === at ? 'now' : 'later',
    })),
  ];
  return (
    <ol className="install-steps">
      {steps.map((s) => (
        <li key={s.label} className={`install-step ${s.state}`}>
          <span className="install-mark">{s.state === 'done' ? <Icon name="check" size={11} /> : null}</span>
          <span className="install-label">{s.label}</span>
          {s.state === 'now' && (
            <span className="update-bar small">
              <span className="indeterminate" />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function UpdateDialog() {
  const update = useStore(studio.store, (s) => s.update);
  const busy = update?.status === 'installing' || update?.status === 'restarting';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        studio.closeUpdateDialog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);
  if (!update) return null;
  const { status, version, current } = update;
  const close = () => studio.closeUpdateDialog();

  let title: string;
  let body: React.ReactNode = null;
  let buttons: React.ReactNode;
  switch (status) {
    case 'available':
      title = 'A new version of Foreword is available';
      body = (
        <>
          <p className="update-lede">
            Foreword {version} is out; you have {current}.{update.installable ? ' Would you like to install it now?' : ''}
          </p>
          {update.notes && (
            <div className="update-notes">
              <div className="update-notes-title">What’s new</div>
              <div className="update-notes-body selectable">
                <Markdown text={update.notes} />
              </div>
            </div>
          )}
          {!update.installable && <p className="update-note">This copy runs from source (npm run app), so it can’t replace itself. Get the new version from its release page.</p>}
        </>
      );
      buttons = update.installable ? (
        <>
          <button onClick={() => studio.skipUpdate()}>Skip This Version</button>
          <span className="spacer" />
          <button onClick={() => void studio.installUpdateOnQuit()}>Install When I Quit</button>
          <button className="primary" autoFocus onClick={() => void studio.installUpdateNow()}>
            Install Now
          </button>
        </>
      ) : (
        <>
          <button onClick={() => studio.skipUpdate()}>Skip This Version</button>
          <span className="spacer" />
          <button onClick={() => void ipc.openUrl(`${RELEASES}/tag/v${version}`)}>Open the Release Page</button>
          <button className="primary" autoFocus onClick={close}>
            OK
          </button>
        </>
      );
      break;
    case 'downloading':
      title = `Downloading Foreword ${version}…`;
      body = (
        <>
          <DownloadProgress update={update} />
          <p className="update-note">{update.onQuit ? 'It installs when you quit.' : 'Then it installs, and Foreword starts again.'}</p>
        </>
      );
      buttons = (
        <>
          <span className="spacer" />
          <button onClick={close}>Hide</button>
        </>
      );
      break;
    case 'downloaded':
      title = update.onQuit ? `Foreword ${version} installs when you quit` : `Foreword ${version} is downloaded`;
      body = <p className="update-lede">Or install it now: Foreword starts again with it, your books as they were.</p>;
      buttons = (
        <>
          {update.onQuit && <button onClick={() => void studio.cancelUpdateOnQuit()}>Don’t Install at Quit</button>}
          <span className="spacer" />
          <button onClick={close}>OK</button>
          <button className="primary" onClick={() => void studio.installUpdateNow()}>
            Install Now
          </button>
        </>
      );
      break;
    case 'installing':
    case 'restarting':
      title = status === 'restarting' ? 'Restarting Foreword…' : `Installing Foreword ${version}…`;
      body = <InstallSteps update={update} />;
      buttons = null;
      break;
    case 'none':
      title = 'Foreword is up to date';
      body = <p className="update-lede">{current} is the newest version.</p>;
      buttons = (
        <>
          <span className="spacer" />
          <button className="primary" autoFocus onClick={close}>
            OK
          </button>
        </>
      );
      break;
    case 'error':
      title = version ? `Foreword ${version} wasn’t installed` : 'Foreword couldn’t check for updates';
      body = <p className="update-error selectable">{update.error}</p>;
      buttons = (
        <>
          <span className="spacer" />
          <button onClick={() => void (version ? studio.installUpdateNow() : studio.checkForUpdates({ dialog: true }))}>Try Again</button>
          <button className="primary" autoFocus onClick={close}>
            OK
          </button>
        </>
      );
      break;
    default:
      title = 'Checking for updates…';
      body = (
        <div className="update-progress">
          <div className="update-bar">
            <span className="indeterminate" />
          </div>
        </div>
      );
      buttons = (
        <>
          <span className="spacer" />
          <button onClick={close}>Cancel</button>
        </>
      );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal update-dialog" role="dialog" aria-modal="true" aria-label={title} data-status={status}>
        <div className="update-main">
          <img className="update-icon" src={appIcon} alt="" width={72} height={72} />
          <div className="update-text">
            <h1>{title}</h1>
            {body}
          </div>
        </div>
        {buttons && <div className="update-buttons">{buttons}</div>}
      </div>
    </div>
  );
}
