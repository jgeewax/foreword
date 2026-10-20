# Build the book from the command line (Foreword's Export PDF does the
# same). Needs the typst command: brew install typst
#
#   make          writes the PDF to export/
#   make watch    rebuilds it whenever a file changes
#   make clean    removes the export folder

MAIN := main.typ
PDF  := export/Luca-s-Wonderful-Brain.pdf

.PHONY: pdf watch clean

pdf:
	@mkdir -p export
	typst compile --root . --font-path "fonts" $(MAIN) $(PDF)
	@echo "Wrote $(PDF)"

watch:
	@mkdir -p export
	typst watch --root . --font-path "fonts" $(MAIN) $(PDF)

clean:
	rm -rf export
