import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { studio } from './app/studio';
import { typstReady } from './editor/monaco';
import { ipc } from './lib/ipc';
import { runSelftest } from './selftest';
import './styles.css';

window.addEventListener('error', (e) => void ipc.uiLog(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => {
  // Monaco cancels its own pending promises (e.g. its WebKit clipboard workaround on every click).
  if (e.reason?.name === 'Canceled') return;
  void ipc.uiLog(`unhandled rejection: ${e.reason?.stack ?? e.reason}`);
});
const boot = (step: string) => void ipc.uiLog(`[boot +${Math.round(performance.now())}ms] ${step}`);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void (async () => {
  boot('init');
  // Highlighting is optional: models created before it's ready re-tokenize when it registers.
  void typstReady.then(() => boot('typst highlighting ready'));
  await studio.init();
  boot(`workspace ${studio.state.workspace?.root ?? '(none)'}`);
  const launch = studio.state.launch;
  if (launch?.selftestOut) {
    boot('selftest');
    await runSelftest(launch);
  }
})().catch((e) => boot(`init failed: ${e?.stack ?? e}`));
