import { useEffect, useState } from 'react';
import { pictureUrl } from '../app/attachments';
import { studio } from '../app/studio';
import { isPictureFile, sizeLabel } from '../services/agent/attached-files';
import type { AttachedFile } from '../services/agent/types';
import { FileIcon, Icon } from './icons';

/** A picture in the book, once it's read (null: it's gone). */
function usePicture(path: string) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void pictureUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

const where = (f: AttachedFile) => (f.path.startsWith('.foreword/attachments/') ? f.name : f.path);

function Remove({ file, onRemove }: { file: AttachedFile; onRemove: (path: string) => void }) {
  return (
    <button className="attached-remove" aria-label={`Remove ${file.name}`} title="Remove" onClick={() => onRemove(file.path)}>
      <Icon name="close" size={10} />
    </button>
  );
}

function Picture({ file, onRemove }: { file: AttachedFile; onRemove?: (path: string) => void }) {
  const url = usePicture(file.path);
  if (url === null) return <FileChip file={file} onRemove={onRemove} />;
  return (
    <span className="attached-picture">
      <button className="attached-open" title={`${where(file)} · ${sizeLabel(file.size)}: open it`} onClick={() => studio.openAttachment(file)}>
        {url ? <img src={url} alt={file.name} draggable={false} /> : <span className="attached-loading" />}
      </button>
      {onRemove && <Remove file={file} onRemove={onRemove} />}
    </span>
  );
}

function FileChip({ file, onRemove }: { file: AttachedFile; onRemove?: (path: string) => void }) {
  return (
    <span className="attached-file">
      <button className="attached-open" title={file.dir ? `${file.path}: show it in Finder` : `${where(file)}: open it`} onClick={() => studio.openAttachment(file)}>
        {file.dir ? <Icon name="folder" size={14} /> : <FileIcon path={file.name} />}
        <span className="attached-name">{file.name}</span>
        <span className="attached-size">{file.dir ? 'folder' : sizeLabel(file.size)}</span>
      </button>
      {onRemove && <Remove file={file} onRemove={onRemove} />}
    </span>
  );
}

/**
 * Files that go with a message: pictures as pictures, other files as chips
 * with their size. Click one to open it. With `onRemove`, in the message box
 * before it's sent, each can be taken off.
 */
export function AttachedFiles({ files, onRemove, className = '' }: { files: readonly AttachedFile[]; onRemove?: (path: string) => void; className?: string }) {
  if (!files.length) return null;
  return (
    <div className={`attached-files ${className}`} aria-label="Attached files">
      {files.map((f) => (isPictureFile(f) ? <Picture key={f.path} file={f} onRemove={onRemove} /> : <FileChip key={f.path} file={f} onRemove={onRemove} />))}
    </div>
  );
}
