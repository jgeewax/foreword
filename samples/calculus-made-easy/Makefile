# Build the book from the command line (Typst Studio's Export PDF does the
# same). Needs the typst command: brew install typst
#
#   make          writes the PDF to export/
#   make watch    rebuilds it whenever a file changes
#   make clean    removes the export folder

MAIN := main.typ
PDF  := export/Calculus-Made-Easy.pdf

.PHONY: pdf watch clean

pdf:
	@mkdir -p export
	typst compile --root . $(MAIN) $(PDF)
	@echo "Wrote $(PDF)"

watch:
	@mkdir -p export
	typst watch --root . $(MAIN) $(PDF)

clean:
	rm -rf export
