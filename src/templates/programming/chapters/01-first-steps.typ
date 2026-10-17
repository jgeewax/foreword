// A chapter with runnable code. #run("name", ```python … ```) shows the code
// and its real output: click ▶ Run above it (or Run all in the Code tab).
// expect: "…" checks the output, so a broken example can't slip into print.
// Give every example its own name.
#import "../style.typ": *
#import "/code.typ": run

= First Steps

Every program in this book runs, and the output you see is what it really
printed. Change an example and its output is marked out of date until you run
it again.

== Printing

#run("hello", ```python
print("Hello, reader!")
```, expect: "Hello, reader!")

== Loops

#run("squares", ```python
for n in range(1, 6):
    print(n, n * n)
```)

#key-idea[Indentation is part of Python's grammar: the body of a loop is the
indented block below it.]

#exercises[
  + Change `squares` to print cubes instead, then run it again.
  + What does `range(1, 6)` produce? Check your answer by running it.
]
