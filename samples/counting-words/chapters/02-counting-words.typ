#import "../style.typ": *
#import "/code.typ": run

= Counting Words

Word count is the number writers check most.
It decides whether a story fits a competition, whether a chapter is running long, and whether today's writing session counts as a good one.
Your word processor counts for you, but it never tells you how.
In this chapter you'll build a word counter of your own, and find out why "word" is harder to pin down than it looks.

== Splitting text into words

A string's `split` method cuts it into pieces wherever there's a space.

#run("split", ```python
line = "It is a truth universally acknowledged"
words = line.split()
print(words)
```, expect: "['It', 'is', 'a', 'truth', 'universally', 'acknowledged']")

What `split` gives back is a _list_: the pieces, in order, between square brackets.
Python shows each piece in single quotation marks to remind you that it's a string.

#definition("List")[An ordered collection of values, written between square brackets and separated by commas, like `['It', 'is', 'a']`.]

`split` treats any run of spaces, tabs or line breaks as a single gap.
That matters, because real text comes in lines and paragraphs.
To put several lines of text in a string, use three quotation marks at each end.

#run("count-words", ```python
opening = """It is a truth universally acknowledged, that a single
man in possession of a good fortune, must be in want of a wife."""
words = opening.split()
print(len(words))
```, expect: "23")

`len`, which counted the characters in a string in the last chapter, counts the items in a list.
So `len(words)` is the number of words: Jane Austen's famous first sentence is 23 words long.

You can also pick a single item out of a list by its position, in square brackets after the list's name.

#run("list-items", ```python
words = "Mr. Bennet made no answer.".split()
print(words[0])
print(words[1])
print(words[-1])
print(len(words))
```, expect: "Mr.\nBennet\nanswer.\n5")

Python counts positions from 0, so `words[0]` is the first word and `words[1]` the second.
Negative positions count back from the end: `words[-1]` is the last word.
Notice that the last word is `answer.`, full stop and all.
Keep that in mind; we'll come back to it.

== Doing something with every word

A _loop_ runs the same lines once for every item in a list.

#run("loop", ```python
for word in "Mr. Bennet made no answer.".split():
    print(word, len(word))
```, expect: "Mr. 3\nBennet 6\nmade 4\nno 2\nanswer. 7")

Read the first line as "for each word in this list".
Each time round, `word` stands for the next word in the list, and Python runs the indented line below.
The colon at the end of the `for` line and the indent of four spaces both matter: together they mark which lines belong to the loop.

When you give `print` several values, separated by commas, it prints them on one line with a space between them.

== Counting as you go

Writing guides often tell you to prefer short words to long ones.
Let's count the long words, of seven letters or more, in the start of Austen's second sentence.

#run("count-long-words", ```python
sentence = """However little known the feelings or views of such a man
may be on his first entering a neighbourhood"""
long_words = 0
for word in sentence.split():
    if len(word) >= 7:
        long_words += 1
print(f"{long_words} long words")
```, expect: "4 long words")

`long_words` starts at 0, before the loop.
Inside the loop, `if` asks a question: is this word 7 or more characters long?
Only when the answer is yes does Python run the line indented below it, where `+=` adds one to `long_words`.
After the loop, back at the left margin, the program prints the total.

Instead of a number, you can keep the words themselves.
Start with an empty list, `[]`, and `append` each long word to it.

#run("collect-long-words", ```python
sentence = """However little known the feelings or views of such a man
may be on his first entering a neighbourhood"""
long_words = []
for word in sentence.split():
    if len(word) >= 7:
        long_words.append(word)
print(long_words)
```, expect: "['However', 'feelings', 'entering', 'neighbourhood']")

== What is a word, anyway?

So far, a word has been whatever sits between two spaces.
Try that on a line of dialogue.

#run("punctuation", ```python
line = '"Is he married or single?"'
print(line.split())
```, expect: "['\"Is', 'he', 'married', 'or', 'single?\"']")

The quotation marks and the question mark are stuck to the words.
To Python, `single?"` and `single` are different words, so a program that counts how often each word appears would count them separately.
Capital letters cause the same trouble.

#run("case", ```python
print("It" == "it")
print("It".lower() == "it")
```, expect: "False\nTrue")

Two equals signs, `==`, ask whether two values are the same, and Python answers `True` or `False`.
`"It"` and `"it"` aren't the same, but once you've made both lower case, they are.

To clean a word, make it lower case and remove any punctuation from its ends with `strip`.

#run("clean-words", ```python
line = '"Do not you want to know who has taken it?"'
words = []
for word in line.split():
    words.append(word.strip('.,;:!?"').lower())
print(words)
```, expect: "['do', 'not', 'you', 'want', 'to', 'know', 'who', 'has', 'taken', 'it']")

`strip` removes the characters you give it from the start and the end of a string, as many as it finds there.
The string `'.,;:!?"'` lists the punctuation to remove.
It's written between single quotation marks because it contains a double one.
If your own writing uses curly quotation marks, add “ and ” to the list too.

`strip` never touches the middle of a word, which is usually what you want.

#run("hard-words", ```python
for word in "Don't stop--it's well-known.".split():
    print(word.strip('.,;:!?"'))
```, expect: "Don't\nstop--it's\nwell-known")

The apostrophes in `Don't` and `it's` stay where they belong, and so does the hyphen in `well-known`.
But the dash in `stop--it's`, typed as two hyphens with no spaces around it, joins two words into one.
Is `well-known` one word or two?
And what about `1813`, or `Mr.`?

There's no right answer, and that's why two word processors can give the same manuscript different word counts.
Each one makes these decisions in its own way.
When you write your own counter, you make them, and the program sticks to them every time.

Here's a counter of your own that makes one of those decisions.
It skips anything with nothing left once the punctuation is gone, such as a dash on its own between two spaces.

#run("word-counter", ```python
draft = "The rain stopped -- or nearly -- and she went out."
count = 0
for word in draft.split():
    if word.strip('.,;:!?"-') != "":
        count += 1
print(f"Splitting at spaces: {len(draft.split())} words")
print(f"Our counter: {count} words")
```, expect: "Splitting at spaces: 11 words\nOur counter: 9 words")

`!=` means "is not the same as", and `""` is the empty string: a string with nothing in it.
This time the punctuation to strip ends with a hyphen, so a lone `--` has nothing left after `strip`, and isn't counted.

#key-idea[
  Python doesn't know what a word is.
  You decide: split at spaces, strip the punctuation, make it lower case.
  Python then follows your rule exactly, every time.
]

#exercises[
  + Put a paragraph of your own writing in `count-words`, between the triple quotation marks.
    Does the count match your word processor's?
  + Change `collect-long-words` so that it finds the words of ten letters or more.
  + In `hard-words`, use `replace` to turn every `--` into a space before you split the text.
    Check that the loop now prints four words.
  + Write a loop that prints every word of a sentence in capitals, one word per line.
]
