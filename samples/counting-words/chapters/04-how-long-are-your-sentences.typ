#import "../style.typ": *
#import "/code.typ": run

= How Long Are Your Sentences?

Read the opening of _Pride and Prejudice_ aloud and you can hear its rhythm.
A long, balanced first sentence, a longer second one, and then the dialogue: quick lines, broken up by "Mr.~Bennet made no answer."
Good prose mixes long sentences with short ones, and a page where every sentence is the same length reads like a list.

Rhythm is something you hear, but sentence length is something you can count.
In this chapter you'll split a text into sentences, measure each one, and draw a small chart of the result, made of nothing but characters.

== Splitting text into sentences

A sentence ends with a full stop, so the first thing to try is splitting the text at every full stop.

#run("naive-split", ```python
line = "Mr. Bennet replied that he had not."
print(line.split("."))
```, expect: "['Mr', ' Bennet replied that he had not', '']")

Give `split` a string and it splits at that string instead of at spaces.
But the result is wrong in three ways.
The full stop after `Mr` isn't the end of a sentence; the split leaves an empty string, `''`, after the last full stop; and the full stops themselves have gone.
Sentences that end with a question mark or an exclamation mark wouldn't be split at all.

== When does a sentence end?

A better rule works with words, the way the last two chapters did.
A word ends a sentence when its last character is a full stop, a question mark or an exclamation mark, not counting any closing quotation marks.
Unless, that is, the word is `Mr.` or `Mrs.`: abbreviations end with a full stop, but not with the end of a sentence.

#run("sentence-ends", ```python
abbreviations = {"Mr.", "Mrs."}
for word in ['last?"', "Mr.", "not.", 'Bennet,"', "enough."]:
    last = word.rstrip('"')[-1]
    print(word, last in ".!?" and word not in abbreviations)
```, expect: "last?\" True\nMr. False\nnot. True\nBennet,\" False\nenough. True")

`rstrip` is `strip` for the right-hand end only: it removes the closing quotation marks.
Then `[-1]` picks out the last character, just as it picked out the last item of a list.
`last in ".!?"` asks whether that character is one of those three.
`and` puts two questions together: the answer is `True` only if both are true.

== Measuring every sentence

Now go through the whole text, word by word.
Collect the words of the sentence you're in, and every time a word ends a sentence, put that sentence away and start a new one.

#run("split-sentences", ```python
abbreviations = {"Mr.", "Mrs."}

with open("texts/opening.txt", encoding="utf-8") as file:
    text = file.read()

sentences = []
current = []
for word in text.split():
    current.append(word)
    if word.rstrip('"')[-1] in ".!?" and word not in abbreviations:
        sentences.append(current)
        current = []
if current:
    sentences.append(current)

print(len(sentences), "sentences")
for sentence in sentences:
    start = " ".join(sentence[:6])
    print(f"{len(sentence):3}  {start}")
```)

Each sentence is kept as a list of its words, so `len(sentence)` is its length in words.
`sentences` is a list of these lists.
`if current:` catches any words left over after the last full stop, in case a text doesn't end with one: a list with something in it counts as true, and an empty one as false.
To print the start of each sentence, `sentence[:6]` takes its first six words, and `" ".join` joins them back into a string with a space between each pair.

Look down the list and the rhythm is there in the numbers: 23, 48, 21, then 7, 19 and 5.
Look again and you'll find a mistake.
Our rule ends a sentence at `it?"`, so it splits _"Do not you want to know who has taken it?" cried his wife impatiently_ in two, and counts _cried his wife impatiently_ as a sentence of its own.
A reader knows better, because the next word doesn't start with a capital letter.
Teaching the program the same thing is the first exercise at the end of this chapter.

== Averages, and what they hide

Here are the sentence lengths the program found, typed into a list.
Python's `sum`, `max` and `min` add them up and find the largest and the smallest.

#run("average", ```python
lengths = [23, 48, 21, 7, 19, 5, 10, 4, 13, 4, 79, 4, 1, 5]
total = sum(lengths)
average = total / len(lengths)
print(f"{len(lengths)} sentences, {total} words")
print(f"Average: {average:.1f} words")
print(f"Longest: {max(lengths)}, shortest: {min(lengths)}")
```, expect: "14 sentences, 243 words\nAverage: 17.4 words\nLongest: 79, shortest: 1")

`{average:.1f}` shows the average with one digit after the decimal point.

The average sentence is about 17 words long, yet half of the sentences have seven words or fewer, and two have more than 45.
They range from Mrs.~Bennet's breathless 79-word report on Netherfield down to a single word: _"Bingley."_
An average can't show you rhythm.
For that, you need to see every sentence.

== Drawing with characters

You don't need a charting tool to draw a chart.
Remember `"ha" * 3` from the exercises in Chapter~1?
`*` repeats a string, so `"#" * 23` is a bar of 23 `#` characters that can stand for a 23-word sentence.
A 79-word sentence would run off the side of the page, though, so in this program each `#` stands for two words.
`math.ceil`, from the `math` module, rounds a number up, so even a one-word sentence gets a mark.

#run("rhythm", ```python
import math

abbreviations = {"Mr.", "Mrs."}

with open("texts/opening.txt", encoding="utf-8") as file:
    text = file.read()

lengths = []
count = 0
for word in text.split():
    count += 1
    if word.rstrip('"')[-1] in ".!?" and word not in abbreviations:
        lengths.append(count)
        count = 0
if count > 0:
    lengths.append(count)

for length in lengths:
    bar = "#" * math.ceil(length / 2)
    print(f"{length:3} {bar}")
print(f"Average: {sum(lengths) / len(lengths):.1f} words")
```)

This time the program doesn't keep the words of each sentence, only how many there are, so `count` takes the place of `current`.

Now you can see the rhythm.
Two long sentences of narration set the scene, the conversation goes back and forth in short lines, and then Mrs.~Bennet's long speech sticks out like a mountain.
After it come a four-word question and a one-word answer, and the answer is the punchline.

== How many of each length?

Sometimes you'd rather know how many sentences of each length a chapter has: lots of short ones, or a steady run of long ones?
A chart of that is called a _histogram_: sort the lengths into groups, count each group, and draw one bar per group.

#run("histogram", ```python
lengths = [23, 48, 21, 7, 19, 5, 10, 4, 13, 4, 79, 4, 1, 5]
short = 0
medium = 0
long = 0
for length in lengths:
    if length < 10:
        short += 1
    elif length < 25:
        medium += 1
    else:
        long += 1
print("short ", "#" * short)
print("medium", "#" * medium)
print("long  ", "#" * long)
```, expect: "short  #######\nmedium #####\nlong   ##")

`elif`, short for "else if", asks a second question when the first answer was no.
A sentence that isn't under 10 words, but is under 25, counts as medium; anything else is long.
Half of the sentences in the opening are short, which is what makes it move so quickly.

#key-idea[
  A sentence is harder to find than a word, so write down your rule and let the program apply it.
  Then draw what you count: a bar per sentence shows rhythm better than any average.
]

#exercises[
  + Teach `split-sentences` that a sentence doesn't end when the next word starts with a lower-case letter.
    (Hint: remember that the sentence _might_ have ended, and decide when you see the next word.
    `word[0].islower()` is `True` when a word starts with a lower-case letter.)
  + Run `rhythm` on a chapter of your own, after adding any abbreviations you use, such as `"Dr."`, to `abbreviations`.
    Find your longest sentence.
    Does it earn its length?
  + Change the groups in `histogram`, for example to under 8, 8 to 19 and 20 or more, and see how the shape changes.
]
