/// <reference types="vite/client" />

// Two of Monaco's own modules, for its label service (editor/uri-labels.ts); the package types only its API.
declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: { get<T>(id: unknown): T };
}
declare module 'monaco-editor/platform/label/common/label.js' {
  export const ILabelService: unknown;
}
