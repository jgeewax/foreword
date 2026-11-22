import { Fragment, useEffect, useMemo, useState } from 'react';
import { pictureUrl } from '../app/attachments';
import { mentionedPaths, mentionParts } from '../app/mentions';
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

/** A message's words, each "@path" of a file or folder that went with it a link that opens it (mentions.ts). */
export function MentionText({ text, files }: { text: string; files: readonly AttachedFile[] }) {
  const parts = useMemo(() => (files.length ? mentionParts(text, files) : [{ text }]), [text, files]);
  return (
    <>
      {parts.map((p, i) => {
        const file = p.path ? files.find((f) => f.path === p.path) : undefined;
        return file ? (
          <button key={i} className="mention" title={file.dir ? `${file.path}/: show it in Finder` : `${file.path}: open it`} onClick={() => studio.openAttachment(file)}>
            {p.text}
          </button>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        );
      })}
    </>
  );
}

/** Of a message's files, those to show below its words: a file its words name is a link there already, but a picture still shows. */
export const filesBelow = (text: string, files: readonly AttachedFile[]) => {
  const named = mentionedPaths(text, files);
  return named.size ? files.filter((f) => isPictureFile(f) || !named.has(f.path)) : files;
};

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
