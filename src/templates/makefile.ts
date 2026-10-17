// A Makefile so a book builds without Typst Studio: `make` writes the PDF to
// export/ with the typst command line (brew install typst).

/** File name for the exported PDF: the book's folder name, made safe for make. */
export function pdfName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'book'}.pdf`;
}

export function makefile(title: string, main = 'main.typ', fontPaths: string[] = []): string {
  const fonts = fontPaths.map((p) => ` --font-path ${JSON.stringify(p)}`).join('');
  return `# Build the book from the command line (Typst Studio's Export PDF does the
# same). Needs the typst command: brew install typst
#
#   make          writes the PDF to export/
#   make watch    rebuilds it whenever a file changes
#   make clean    removes the export folder

MAIN := ${main}
PDF  := export/${pdfName(title)}

.PHONY: pdf watch clean

pdf:
\t@mkdir -p export
\ttypst compile --root .${fonts} $(MAIN) $(PDF)
\t@echo "Wrote $(PDF)"

watch:
\t@mkdir -p export
\ttypst watch --root .${fonts} $(MAIN) $(PDF)

clean:
\trm -rf export
`;
}
