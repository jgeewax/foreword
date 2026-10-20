#import "../style.typ": *
#import "/code.typ": run

= The Words You Use Most

Every writer has favourite words, and most of us don't know what ours are until an editor circles them.
_Just_, _really_, _suddenly_, _very_: they slip into a draft unnoticed and multiply.
In this chapter you'll count every word in a text, find the ones it uses most, and look for your own habits.

To do that, Python has to keep a separate count for each word.
For that you need a new kind of value: the dictionary.

== Dictionaries

A dictionary links _keys_ to _values_, the way a real dictionary links each word to its meaning.
Here, each key is a word and each value is how often it appears.

#run("dictionary", ```python
counts = {"bennet": 3, "dear": 2}
print(counts["bennet"])
counts["dear"] += 1
counts["netherfield"] = 2
print(counts)
```, expect: "3\n{'bennet': 3, 'dear': 3, 'netherfield': 2}")

You look a value up by putting its key in square brackets, as you did with positions in a list.
`+=` adds one to the count that's already there.
Giving a value to a key the dictionary doesn't have yet, like `"netherfield"`, adds it.

#definition("Dictionary")[
  A collection of keys, each linked to a value, written between curly braces, like `{"bennet": 3, "dear": 2}`.
  Each key appears only once.
]

To count the words in a text, go through them one at a time.
If a word is already in the dictionary, add one to its count; if it isn't, put it in with a count of 1.

#run("count-each-word", ```python
text = "Mr. Bennet replied that he had not. Mr. Bennet made no answer."
counts = {}
for word in text.split():
    word = word.strip('.,;:!?"').lower()
    if word in counts:
        counts[word] += 1
    else:
        counts[word] = 1
print(counts["mr"])
print(counts["answer"])
print(len(counts))
```, expect: "2\n1\n10")

`{}` is an empty dictionary.
`word in counts` asks whether the word is already one of its keys, and `else` says what to do when it isn't.
The line `word = word.strip(…).lower()` replaces each word with its cleaned-up version, so `Mr.` is counted as `mr`.
At the end, `len(counts)` is the number of keys: the text uses ten different words.

== Letting Python do the counting

Counting things is so common that Python comes with a tool for it, called `Counter`.
It lives in a _module_, a collection of extra tools, called `collections`.
To use it, _import_ it at the top of your program.

#run("counter", ```python
from collections import Counter

text = "Mr. Bennet replied that he had not. Mr. Bennet made no answer."
words = []
for word in text.split():
    words.append(word.strip('.,;:!?"').lower())
counts = Counter(words)
print(counts.most_common(3))
```)

Give `Counter` a list and it counts everything in it, just as the loop did above.
The result is a dictionary with a few extras.
The most useful one is `most_common`, which gives you the most frequent words first, each paired with its count.
When two words have the same count, the one that appeared first comes first.

== Reading a text file

Two sentences are enough to try out an idea, but the questions you care about are about whole chapters.
Pasting a chapter into a program isn't practical, so keep the text in a file and let the program read it.
This book's folder has a file called `texts/opening.txt`, with the opening paragraphs of _Pride and Prejudice_.

#run("read-file", ```python
with open("texts/opening.txt", encoding="utf-8") as file:
    text = file.read()
print(text[:60])
print(len(text.split()), "words")
```, expect: "It is a truth universally acknowledged, that a single man in\n243 words")

`open` looks for the file starting from the folder the program runs in, which in Foreword is the book's folder.
`with … as file:` opens it and calls it `file`, and the indented line below reads all of it into `text`.
When the indented lines are done, Python closes the file again.
`encoding="utf-8"` makes sure that accented letters and curly quotation marks come through correctly.
`text[:60]` means the first 60 characters of the text, which is a quick way to check you've read the right file.

To use your own writing, save a chapter as plain text: in most word processors, choose File, then Save As, and pick _Plain Text_ (`.txt`).
Put the file in the `texts` folder and change the name in `open`.

== The most common words

Now put the pieces together: read the file, clean every word, and count them.

#run("common-words", ```python
from collections import Counter

with open("texts/opening.txt", encoding="utf-8") as file:
    text = file.read()

words = []
for word in text.split():
    words.append(word.strip('.,;:!?"').lower())

for word, count in Counter(words).most_common(8):
    print(f"{count:3}  {word}")
```, expect: " 10  of\n  9  is\n  8  a\n  8  that\n  8  the\n  7  to\n  6  it\n  6  he")

`most_common` gives back pairs, and `for word, count in` takes each pair apart into its two halves.
In the f-string, `{count:3}` makes the number take up three characters, so the columns line up.

The result is a little disappointing.
_Of_, _is_, _a_, _that_, _the_: these are the most common words in almost any English text.
They hold sentences together, but they tell you nothing about this one.

== Leaving out the little words

Words like these are called _stop words_, and programs that study text usually leave them out.
Keep them in a _set_: a collection, between curly braces, where all that matters is whether a word is in it or not.

#run("stop-words", ```python
from collections import Counter

stop_words = {
    "a", "and", "at", "be", "been", "but", "by", "for", "from", "had",
    "has", "have", "he", "her", "his", "i", "in", "is", "it", "me",
    "must", "my", "no", "not", "of", "on", "one", "or", "she", "so",
    "some", "that", "the", "their", "this", "to", "was", "who", "you",
}

with open("texts/opening.txt", encoding="utf-8") as file:
    text = file.read()

words = []
for word in text.split():
    word = word.strip('.,;:!?"').lower()
    if word not in stop_words:
        words.append(word)

for word, count in Counter(words).most_common(10):
    print(f"{count:3}  {word}")
```, expect: "  4  mr\n  3  man\n  3  want\n  3  bennet\n  2  truth\n  2  single\n  2  possession\n  2  fortune\n  2  wife\n  2  dear")

`not in` is the opposite of `in`: the word is only kept when it isn't a stop word.

Now the list says something about the book.
_Truth_, _single_, _possession_, _fortune_ and _wife_ all appear in the first sentence, which sets out what the novel is about.
And _mr_ comes top: in Austen's world, even the narrator and his own wife call Mr.~Bennet _Mr.~Bennet_.
Whether _mr_ is a stop word is up to you.
There's no official list: every program that uses stop words has its own, so add or remove words until the results tell you something.

== Your own habits

`Counter` is also the quickest way to check a draft for words you know you overuse.

#run("habit-words", ```python
from collections import Counter

draft = """She just wanted to go home. It was really late, the party
was very loud, and she was really very tired of just smiling."""

words = []
for word in draft.split():
    words.append(word.strip('.,;:!?"').lower())
counts = Counter(words)

for word in ["just", "really", "very", "suddenly"]:
    print(f"{word}: {counts[word]}")
```, expect: "just: 2\nreally: 2\nvery: 2\nsuddenly: 0")

`suddenly` isn't in the draft at all, and `Counter` says so with a 0.
An ordinary dictionary would stop the program with an error if you asked it for a key it doesn't have; a `Counter` just answers 0.

#key-idea[
  A dictionary links keys to values, and a `Counter` is a dictionary made for counting.
  Read your text from a file, clean the words, leave out the stop words, and the words that are left tell you what the text is about.
]

#exercises[
  + Save a chapter of your own as plain text in `texts`, and run `stop-words` on it.
    Which words come top?
    Are any of them a surprise?
  + Add `"mr"` and `"mrs"` to `stop_words`.
    Which words move up the list?
  + Change the list in `habit-words` to your own favourite words, and run it on your chapter.
  + How many different words does the opening of _Pride and Prejudice_ use?
    (Hint: `len` of a `Counter` is the number of different words in it.)
]
