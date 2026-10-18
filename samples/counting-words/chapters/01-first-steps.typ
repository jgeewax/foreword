// A chapter with runnable code. #run("name", ```python … ```) shows the code
// and its real output: click ▶ Run above it (or Run all in the Code tab).
// expect: "…" checks the output, so a broken example can't slip into print.
// Give every example its own name.
#import "../style.typ": *
#import "/code.typ": run

= First Steps

You already spend your days with text.
You count words to meet a deadline, cut a blurb to fit the back cover, and wonder whether you lean on the same few words too often.
This book teaches you enough Python to answer questions like these yourself, one small program at a time.

Every program in this book runs, and the output under it is what it really printed.
When the output says _Output ✓_, the book also checked it against what the text says it should be.
To run a program yourself, click Run above it in Typst Studio.
Or type it into a file called, say, `hello.py`, and run it in a terminal with `python3 hello.py`.

== Your first program

#run("hello", ```python
print("Hello, writer.")
```, expect: "Hello, writer.")

`print` shows whatever you put between its parentheses.
The quotation marks tell Python that `Hello, writer.` is text, to be shown as it is, and not an instruction.
They aren't part of the text itself: look at the output, and they've gone.

#definition("String")[
  A piece of text in a program, written between quotation marks, like `"Hello, writer."`.
  Python calls text a _string_, as in a string of characters.
]

You can use single or double quotation marks, as long as both ends match.
That's handy for dialogue: put a line that contains double quotation marks between single ones.

#run("dialogue", ```python
print('"Mr. Bennet made no answer."')
```, expect: "\"Mr. Bennet made no answer.\"")

A program can have as many lines as you like, and Python runs them from top to bottom.
A `+` between two strings glues them together.
It doesn't add a space, so put the spaces in yourself.

#run("joining", ```python
print("It is a truth " + "universally acknowledged,")
print("that a single man in possession of a good fortune,")
print("must be in want of a wife.")
```, expect: "It is a truth universally acknowledged,\nthat a single man in possession of a good fortune,\nmust be in want of a wife.")

== Giving things names

Most programs work on the same text more than once, so it helps to give it a name.

#run("variables", ```python
title = "Pride and Prejudice"
author = "Jane Austen"
print(title)
print(author)
```, expect: "Pride and Prejudice\nJane Austen")

Read the `=` as "stands for", not "equals".
The first line tells Python that from now on, `title` stands for the string `"Pride and Prejudice"`.
When `print(title)` runs, Python looks the name up and prints what it stands for.

#definition("Variable")[
  A name that stands for a value, such as a string or a number.
  You choose the name; Python remembers what it stands for.
]

Choose names that say what the thing is: `title`, `first_line`, `chapter_count`.
Python names can't contain spaces, so join the words with underscores, and keep them in lower case.

The best way to mix your own words with a variable is an _f-string_: a string with an `f` just before the opening quotation mark.
Inside it, anything between curly braces is replaced by its value.

#run("f-strings", ```python
title = "Pride and Prejudice"
year = 1813
print(f"{title} was first published in {year}.")
```, expect: "Pride and Prejudice was first published in 1813.")

`1813` has no quotation marks, because it's a number, not text.
Python can do arithmetic with numbers: `+`, `-`, `*` for multiplication and `/` for division.
Here is a question every novelist asks sooner or later.

#run("words-per-day", ```python
novel = 85000
per_day = 1000
days = novel / per_day
print(f"{days} days")
print(f"About {round(days / 7)} weeks")
```, expect: "85.0 days\nAbout 12 weeks")

Write numbers without commas: `85000`, not `85,000`, because a comma means something else in Python.
Division always gives a number with a decimal point, so 85000 divided by 1000 prints as `85.0`.
`round` rounds a number to the nearest whole one: 85 days is a little over 12 weeks.

== How long is a string?

`len`, short for length, counts the characters in a string.

#run("len", ```python
line = "Mr. Bennet made no answer."
print(len(line))
```, expect: "26")

Every character counts: the letters, the spaces between the words and both full stops.
So the line is 26 characters long, though it has only five words.
Counting words takes a little more work, and it's what the next chapter is about.

Character counts matter more often than you might think.
Imagine your publisher wants a tagline of no more than 50 characters.

#run("tagline", ```python
tagline = "Five sisters, one rich stranger, and a mother with a plan."
limit = 50
print(f"{len(tagline)} characters")
print(f"{len(tagline) - limit} too many")
```, expect: "58 characters\n8 too many")

Notice that `len(tagline)` works inside the curly braces of an f-string, just as it does on its own.

== Strings can do things

A string comes with a set of handy tools, called _methods_.
To use one, write a full stop after the string, then the method's name and a pair of parentheses.

#run("methods", ```python
name = "Elizabeth Bennet"
print(name.upper())
print(name.lower())
print(name.replace("Bennet", "Darcy"))
```, expect: "ELIZABETH BENNET\nelizabeth bennet\nElizabeth Darcy")

`upper` and `lower` change the case of every letter, and `replace` swaps one piece of text for another.
None of them changes `name` itself: each gives you a new string, and `name` still stands for `"Elizabeth Bennet"`.
You'll need `lower` in the next chapter, when Python has to learn that "It" and "it" are the same word.

#key-idea[
  A string is a piece of text, and a variable is a name that stands for a value.
  `len` counts characters, not words.
]

#exercises[
  + Change `hello` so that it greets you by name.
    Keep your name in a variable and use an f-string.
  + Put the tagline of a book you love in `tagline`.
    Does it fit in 50 characters?
  + At 500 words a day, how many weeks would the 85,000-word novel take?
    Change `words-per-day` to find out.
  + What do you think `print("ha" * 3)` prints?
    Run it to check.
    (You'll use this in Chapter~4.)
]
