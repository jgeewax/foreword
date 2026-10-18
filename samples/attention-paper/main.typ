#import "@preview/bloated-neurips:0.8.0": neurips2026, paragraph, url
#import "/figures.typ": attention-diagrams, transformer-diagram

#let affls = (
  original: (
    [Restating Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser and Polosukhin, _Attention Is All You Need_ (NeurIPS 2017)],
  ),
)

#let authors = (
  (name: "A Typst Studio sample", affl: "original"),
)

// The note at the foot of the first page. It replaces the template's
// NeurIPS 2026 notice (the `aux` override in the package README): the paper
// appeared at NIPS 2017, and this text is a restatement of it.
#let notice(accepted) = [
  A restatement, written for Typst Studio, of a paper presented at the 31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA.
  The wording is not the original authors'; their paper is at #url("https://arxiv.org/abs/1706.03762").
]

#show: neurips2026.with(
  title: [Attention Is All You Need],
  authors: (authors, affls),
  keywords: ("Transformer", "Attention", "Machine translation", "Sequence transduction"),
  abstract: [
    Neural sequence transduction has been dominated by encoder--decoder models built from recurrent or convolutional networks, the strongest of which link the encoder to the decoder through attention.
    The Transformer keeps the encoder--decoder layout but drops recurrence and convolution altogether: both halves are built from attention and position-wise feed-forward layers alone.
    Because no layer has to wait for the previous position, training parallelizes far better, and on two machine-translation benchmarks the model beats the systems it is compared with while using less training compute.
    On WMT 2014 English-to-German it reaches 28.4 BLEU, more than 2 BLEU above the best earlier results, ensembles included.
    On WMT 2014 English-to-French a single model reaches 41.8 BLEU after 3.5 days on eight GPUs, a new single-model state of the art for a fraction of what the strongest earlier systems cost to train.
    With little task-specific tuning, the same architecture also parses English constituency trees well, whether trained on 40K sentences or on 17M.
  ],
  bibliography: bibliography("refs.bib"),
  accepted: true,
  // Times New Roman ships with macOS. Naming only it (the template also
  // lists Nimbus Roman and TeX Gyre Termes) avoids a warning for each
  // fallback that isn't installed.
  aux: (get-notice: notice, font: (family: ("Times New Roman",))),
)

// The template's heading rule doesn't keep a heading with the text after it,
// so a heading could end up alone at the foot of a page. A sticky block fixes
// that; its spacing above and below is the template's (whose own spacing
// disappears inside the block).
#show heading: it => {
  let (above, below) = if it.level == 1 {
    (21.5pt, 15.9pt)
  } else if it.level == 2 {
    (17.9pt, 13.4pt)
  } else {
    (17.2pt, 11.9pt)
  }
  block(sticky: true, above: above, below: below, it)
}

// Table cells aren't justified (the template justifies all text). Tables use
// booktabs rules, written out as `table.hline(stroke: 0.08em)` at the top and
// bottom and `table.hline(stroke: 0.05em)` between groups (the package's
// `toprule`, `botrule` and `midrule`), so that formatting keeps one row per line.
#show table: set par(justify: false)

= Introduction <sec-intro>

Until 2017, the best results in language modeling, machine translation and other sequence tasks came from recurrent networks @sutskever2014sequence @bahdanau2014neural @cho2014learning, usually built from long short-term memory cells @hochreiter1997long or gated recurrent units @chung2014empirical.
A large body of work kept improving recurrent language models and recurrent encoder--decoder systems @wu2016google @luong2015effective @jozefowicz2016exploring.

A recurrent layer works through a sequence in order.
Its hidden state $h_t$ at position $t$ is computed from $h_(t-1)$ and the input at $t$, so position $t$ cannot be processed until position $t - 1$ has been.
Within one training example nothing can run in parallel, and this hurts most on long sequences, where memory also limits how many examples fit in a batch.
Factorized LSTM cells @kuchaiev2017factorization made recurrent layers cheaper, and sparsely gated mixture-of-experts layers @shazeer2017outrageously made them both cheaper and more accurate.
Every recurrent layer, however, still steps through its input one position at a time.

Attention lets a model connect two positions directly, however far apart they are in the input or the output @bahdanau2014neural @kim2017structured, and by 2017 it was part of nearly every strong sequence model.
Apart from a few exceptions such as @parikh2016decomposable, though, it was added to a recurrent network rather than used in place of one.

The Transformer removes the recurrence.
It models the dependencies within and between input and output with attention alone, so each of its layers processes all positions at once.
Its base configuration, trained for twelve hours on one machine with eight P100 GPUs, already beats the best previously published English-to-German translation results.

This document restates, in new words, the paper that introduced the model @vaswani2017attention: the architecture, the case for self-attention, the training setup and the results.
All numbers are the ones reported there.

= Background <sec-background>

Earlier attempts to reduce sequential computation include the Extended Neural GPU @kaiser2016active, ByteNet @kalchbrenner2016neural and ConvS2S @gehring2017convolutional.
They are built from convolutions, which compute the hidden representation of every position simultaneously.
How far apart two positions are, however, determines how many layers a signal must cross to connect them: that number grows linearly with the distance in ConvS2S and logarithmically in ByteNet.
The longer the route, the harder it is to learn a dependency between the two positions @hochreiter2001gradient.
In the Transformer the route always takes a constant number of operations.
The cost is a coarser effective resolution, since attention averages over the positions it weights; multi-head attention (@sec-multihead) counteracts this.

In self-attention, also called intra-attention, the queries, keys and values all come from the same sequence, so each position's new representation is computed from the other positions of that sequence.
It had already helped in machine reading @cheng2016long, textual entailment @parikh2016decomposable, summarization @paulus2017deep and general-purpose sentence embeddings @lin2017structured.
End-to-end memory networks @sukhbaatar2015end replace recurrence over the sequence with attention applied repeatedly to a memory, and do well at answering questions about simple texts and at language modeling.

As far as its authors knew, the Transformer was the first transduction model to rely on self-attention alone to represent both what it reads and what it writes, with no recurrence along the sequence and no convolution.
The rest of this document describes the model (@sec-model), argues for self-attention against models such as the Neural GPU @kaiser2016neural, ByteNet and ConvS2S (@sec-why), and reports how the models were trained (@sec-training) and how they performed (@sec-results).

= Model architecture <sec-model>

The strongest neural transduction models of the time were encoder--decoder models @cho2014learning @bahdanau2014neural @sutskever2014sequence.
An encoder reads the input symbols $(x_1, ..., x_n)$ and produces one continuous vector per position, $bold(z) = (z_1, ..., z_n)$.
A decoder then generates the output $(y_1, ..., y_m)$ from $bold(z)$, one symbol per step, feeding each symbol it has generated back in as input for the next step; that is, it is auto-regressive @graves2013generating.
The Transformer keeps this layout.
@fig-transformer shows its encoder and decoder, both made of stacked self-attention and position-wise feed-forward layers.

#figure(
  transformer-diagram,
  caption: [
    The Transformer, with the encoder on the left and the decoder on the right.
    Each is a stack of $N = 6$ identical layers, and every sub-layer is followed by a residual sum and layer normalization (Add & norm).
    The decoder's middle sub-layer takes its keys and values from the encoder's output.
    Drawn for this sample after Figure 1 of @vaswani2017attention.
  ],
  placement: top,
) <fig-transformer>

== Encoder and decoder stacks

#paragraph[Encoder]
Six identical layers ($N = 6$) make up the encoder.
Each layer applies multi-head self-attention and then a feed-forward network that acts on each position separately.
Both sub-layers are wrapped the same way: a residual connection @he2016deep adds the sub-layer's input to its output, and layer normalization @ba2016layer follows, so a sub-layer computing $f$ turns its input $x$ into $"LayerNorm"(x + f(x))$.
The residual sums need matching widths, so all sub-layers, and the embedding layers too, output vectors of dimension $d_"model" = 512$.

#paragraph[Decoder]
The decoder is also a stack of six identical layers, but each has three sub-layers.
Between self-attention and the feed-forward network sits an attention sub-layer whose keys and values come from the encoder's final output.
All three sub-layers get the same residual connection and layer normalization.
The decoder's self-attention is masked so that position $i$ sees only positions $1, ..., i$.
Because the target sequence is also fed in shifted one place to the right, the prediction at position $i$ can use only outputs that are already known, those before $i$.

== Attention

Attention combines a set of values, weighting each one by how well its key matches a query.
The query, the keys, the values and the result are all vectors, and the result is the weighted sum of the values.
Attention functions differ in how they score the match between a query and a key.

#figure(
  attention-diagrams,
  caption: [
    (a) Scaled dot-product attention, @eq-attention; the mask is used only in the decoder's self-attention.
    (b) Multi-head attention, @eq-multihead, with $h$ heads running in parallel on their own projections.
    Drawn for this sample after Figure 2 of @vaswani2017attention.
  ],
  placement: top,
) <fig-attention>

=== Scaled dot-product attention

The Transformer scores matches with a scaled dot product (@fig-attention, left).
Queries and keys have $d_k$ components and values have $d_v$.
Each query is compared with every key by a dot product, the products are divided by $sqrt(d_k)$, and a softmax turns them into weights for the values.
Usually many queries are processed together.
With the queries stacked as the rows of a matrix $Q$, and the keys and values as the rows of $K$ and $V$, all the outputs are
$ "Attention"(Q, K, V) = "softmax"((Q K^top) / sqrt(d_k)) V. $ <eq-attention>

The common alternatives are additive attention @bahdanau2014neural, which scores a query--key pair with a feed-forward network that has one hidden layer, and plain dot-product (multiplicative) attention, which is @eq-attention without the factor $1 \/ sqrt(d_k)$.
Their asymptotic costs are alike, but the dot-product form reduces to matrix multiplication, for which very fast and memory-efficient code exists, so it is much quicker in practice.
Britz et al. @britz2017massive found the two about equal for small $d_k$, but additive attention ahead of unscaled dot products once $d_k$ is large.
A plausible cause is that dot products grow with $d_k$: for random query and key vectors their variance is $d_k$.#footnote[If the components of $q$ and $k$ are independent with mean 0 and variance 1, then $q dot k = sum_(i=1)^(d_k) q_i k_i$ has mean 0 and variance $d_k$.]
Large logits saturate the softmax, where its gradient almost vanishes; dividing by $sqrt(d_k)$ brings the variance back to 1.

=== Multi-head attention <sec-multihead>

Instead of one attention function on queries, keys and values of dimension $d_"model"$, the Transformer runs $h$ of them side by side, each on its own learned projections (@fig-attention, right).
Head $i$ projects the queries and keys to $d_k$ dimensions and the values to $d_v$ dimensions, and applies @eq-attention to get outputs of dimension $d_v$.
The heads' outputs are concatenated and projected back to $d_"model"$ dimensions:
$
  "MultiHead"(Q, K, V) & = "Concat"("head"_1, ..., "head"_h) W^O, \
              "head"_i & = "Attention"(Q W_i^Q, K W_i^K, V W_i^V),
$ <eq-multihead>
where the learned projections $W_i^Q$, $W_i^K$, $W_i^V$ and $W^O$ are matrices of size #box($d_"model" times d_k$), #box($d_"model" times d_k$), #box($d_"model" times d_v$) and #box($h d_v times d_"model"$).

Separate heads can attend to different positions for different reasons, each in its own subspace of the representation; a single head would have to average all of this into one distribution.
The model uses $h = 8$ heads with $d_k = d_v = d_"model" \/ h = 64$.
Each head works in a space eight times narrower than $d_"model"$, so all eight together cost about as much as one head at full width.

=== How the model uses attention

Multi-head attention plays three roles in the Transformer.

- *Encoder--decoder attention.*
  In the middle sub-layer of each decoder layer, the queries come from the decoder layer below and the keys and values from the encoder's output.
  Every decoder position can therefore look at every input position, like the attention in earlier sequence-to-sequence models @wu2016google @bahdanau2014neural @gehring2017convolutional.
- *Encoder self-attention.*
  Queries, keys and values are all the output of the encoder layer below, and each position may attend to every position.
- *Decoder self-attention.*
  Each position may attend to itself and to the positions before it, but not to later ones, so that the decoder stays auto-regressive.
  Inside @eq-attention this is done by setting the softmax inputs for forbidden query--key pairs to $-infinity$, which gives them zero weight.

== Position-wise feed-forward networks

The last sub-layer of every encoder and decoder layer is a small fully connected network applied to each position on its own: two linear maps with a ReLU between them,
$ "FFN"(x) = max(0, x W_1 + b_1) W_2 + b_2. $ <eq-ffn>
All positions in a layer share its weights, while different layers have different weights.
(Equivalently, it is a pair of convolutions with kernel size 1 over the sequence.)
The network maps $d_"model" = 512$ dimensions up to $d_"ff" = 2048$ and back.

== Embeddings and softmax

Tokens on both sides are embedded as learned vectors with $d_"model"$ components.
On the output side, a learned linear map and a softmax turn the decoder's final vectors into probabilities for the next token.
The input embedding, the output embedding and that final linear map all use one shared weight matrix, following @press2016using; when it serves as an embedding, its entries are multiplied by $sqrt(d_"model")$.

== Positional encoding

Self-attention by itself ignores word order: permuting the inputs of an encoder layer simply permutes its outputs.
Position therefore has to be supplied explicitly.
At the bottom of both stacks, a positional encoding with the same dimension $d_"model"$ is added to each token embedding.
Such encodings can be learned or fixed @gehring2017convolutional; the Transformer uses fixed sinusoids of different frequencies,
$
    "PE"_(("pos", 2i)) & = sin("pos"\/10000^(2i \/ d_"model")), \
  "PE"_(("pos", 2i+1)) & = cos("pos"\/10000^(2i \/ d_"model")),
$ <eq-pe>
where $"pos"$ is the position and $i$ indexes pairs of dimensions.
The wavelengths increase geometrically, from $2 pi$ for the first pair of dimensions to nearly $10000 dot 2 pi$ for the last.
The authors expected this form to make relative positions easy to use: for a fixed offset $k$, $"PE"_("pos"+k)$ is a linear function of $"PE"_"pos"$, since each sine--cosine pair is rotated by an angle that depends only on $k$.
Learned positional embeddings @gehring2017convolutional gave almost the same results (@tab-variations, row E).
Fixed sinusoids are defined for every position, which might help on sequences longer than any in the training data, so they were kept.

= Why self-attention <sec-why>

This section weighs self-attention against recurrent and convolutional layers in the job they usually do as a hidden layer of an encoder or decoder: turning a sequence of $n$ vectors $(x_1, ..., x_n)$ into another sequence of the same length, $(z_1, ..., z_n)$, with $x_i, z_i in RR^d$.
Three properties favor self-attention.

The first is the total computation per layer.
The second is how much of that computation can run in parallel, counted as the fewest operations that have to run one after another.
The third is the length of the path through the network between two positions that depend on each other.
Many transduction tasks hinge on such long-range dependencies, and the gradient that links two dependent positions has to pass through every layer and step between them: the shorter that route, the easier the dependency is to learn @hochreiter2001gradient.
@tab-complexity therefore also gives, for each layer type, the longest route between an input position and an output position.

#figure(
  caption: [
    Cost per layer, minimum number of sequential operations and maximum path length for four kinds of layer.
    $n$ is the sequence length, $d$ the representation size, $k$ the convolution kernel size and $r$ the neighborhood size in restricted self-attention.
    From @vaswani2017attention[Table 1].
  ],
  placement: top,
  table(
    columns: 4,
    align: (left, center, center, center),
    stroke: none,
    inset: (x: 5pt, y: 3.5pt),
    table.hline(stroke: 0.08em),
    table.header([Layer type], [Complexity \ per layer], [Sequential \ operations], [Maximum \ path length]),
    table.hline(stroke: 0.05em),
    [Self-attention], $O(n^2 dot d)$, $O(1)$, $O(1)$,
    [Recurrent], $O(n dot d^2)$, $O(n)$, $O(n)$,
    [Convolutional], $O(k dot n dot d^2)$, $O(1)$, $O(log_k n)$,
    [Restricted self-attention], $O(r dot n dot d)$, $O(1)$, $O(n \/ r)$,
    table.hline(stroke: 0.08em),
  ),
) <tab-complexity>

In self-attention every position reaches every other in $O(1)$ sequential steps; a recurrent layer needs $O(n)$.
Per layer, self-attention is also cheaper than recurrence whenever the sequence is shorter than the representation is wide, $n < d$.
That is the usual case for the sentence representations of state-of-the-art translation systems, which use word-piece @wu2016google or byte-pair @sennrich2015neural vocabularies.
When sequences are very long, each output position could attend only to the $r$ input positions nearest to it, at the price of paths up to $O(n \/ r)$ long; the authors left this restricted form for future work.

A convolution with kernel width $k < n$ sees only $k$ positions at a time, so a single layer leaves most pairs of input and output positions unconnected.
Linking them all takes a stack of $O(n \/ k)$ layers with contiguous kernels, or $O(log_k n)$ with dilated convolutions @kalchbrenner2016neural, and lengthens the longest paths.
Per layer, a convolution also costs about $k$ times as much as a recurrent layer.
Separable convolutions @chollet2016xception bring the cost down considerably, to $O(k dot n dot d + n dot d^2)$.
Even at $k = n$, though, a separable convolution costs as much as one self-attention layer plus one position-wise feed-forward layer: the very combination the Transformer is made of.

Self-attention may also make models easier to interpret.
The attention weights of a trained model can be read off directly, and in the examples the authors examined, different heads had specialized in visibly different ways.
Several of them tracked the structure of the sentence, for example by linking a pronoun to the noun it refers to, or a verb to a complement many words away.

= Training <sec-training>

This section gives the training setup of the translation models.

== Data and batching

For English--German, the training data was the standard WMT 2014 set: roughly 4.5 million sentence pairs, byte-pair encoded @britz2017massive with a joint source--target vocabulary of about 37,000 tokens.
English--French used the much larger WMT 2014 corpus of 36 million sentences, with tokens split into a vocabulary of 32,000 word-pieces @wu2016google.
Sentence pairs of similar length were batched together, so that each batch held about 25,000 source tokens and 25,000 target tokens.

== Hardware and schedule

Each model was trained on a single machine with eight NVIDIA P100 GPUs.
A base model, with the hyperparameters given in this document, ran at about 0.4 seconds per step and was trained for 100,000 steps (12 hours).
A big model (last row of @tab-variations) ran at 1.0 seconds per step and was trained for 300,000 steps (3.5 days).

== Optimizer

Training used Adam @kingma2015adam with $beta_1 = 0.9$, $beta_2 = 0.98$ and $epsilon = 10^(-9)$.
The learning rate followed the schedule
$
  "lrate" = d_"model"^(-0.5) dot min("step_num"^(-0.5), "step_num" dot "warmup_steps"^(-1.5)).
$ <eq-lrate>
It climbs linearly over the first $"warmup_steps" = 4000$ steps, peaks there at about $7 times 10^(-4)$ for $d_"model" = 512$, and afterwards decays as $"step_num"^(-1\/2)$.

== Regularization

#paragraph[Residual dropout]
Each sub-layer's output passes through dropout @srivastava2014dropout, with rate $P_"drop"$, before it joins the residual sum, and so does the embedding-plus-positional-encoding input of each stack.
The base model uses $P_"drop" = 0.1$.

#paragraph[Label smoothing]
Training targets were smoothed with $epsilon_"ls" = 0.1$ @szegedy2015rethinking: a tenth of each target's probability mass is spread uniformly over the vocabulary.
On the development set this makes perplexity worse (4.92 with smoothing against 4.67 without, @tab-variations rows D) but BLEU better (25.8 against 25.3).

= Results <sec-results>

== Machine translation

On WMT 2014 English-to-German, the big Transformer scores 28.4 BLEU (@tab-mt), more than 2.0 BLEU above every previously reported model, ensembles included.
Its configuration is the last row of @tab-variations, and it trained for 3.5 days on eight P100 GPUs.
Even the base model, much cheaper to train than any of them, beats all earlier published models and ensembles.

#figure(
  caption: [
    Translation quality (BLEU on newstest2014) and estimated training cost.
    The big Transformer has the best BLEU on both language pairs, and on English-to-French it cost under a quarter as much to train as any earlier model.
    On English-to-German, the base model beats every earlier result for about a third of the cheapest one's training cost.
    From @vaswani2017attention[Table 2].
  ],
  placement: top,
  table(
    columns: 5,
    align: (left, center, center, center, center),
    stroke: none,
    inset: (x: 5pt, y: 3.5pt),
    table.hline(stroke: 0.08em),
    table.header(
      [], table.cell(colspan: 2)[BLEU], table.cell(colspan: 2)[Training cost (FLOPs)],
      table.hline(start: 1, end: 3, stroke: 0.05em),
      table.hline(start: 3, end: 5, stroke: 0.05em),
      [Model], [EN-DE], [EN-FR], [EN-DE], [EN-FR],
    ),
    table.hline(stroke: 0.05em),
    [ByteNet @kalchbrenner2016neural], [23.75], [], [], [],
    [Deep-Att + PosUnk @zhou2016deep], [], [39.2], [], $1.0 dot 10^20$,
    [GNMT + RL @wu2016google], [24.6], [39.92], $2.3 dot 10^19$, $1.4 dot 10^20$,
    [ConvS2S @gehring2017convolutional], [25.16], [40.46], $9.6 dot 10^18$, $1.5 dot 10^20$,
    [MoE @shazeer2017outrageously], [26.03], [40.56], $2.0 dot 10^19$, $1.2 dot 10^20$,
    table.hline(stroke: 0.05em),
    [Deep-Att + PosUnk ensemble @zhou2016deep], [], [40.4], [], $8.0 dot 10^20$,
    [GNMT + RL ensemble @wu2016google], [26.30], [41.16], $1.8 dot 10^20$, $1.1 dot 10^21$,
    [ConvS2S ensemble @gehring2017convolutional], [26.36], [41.29], $7.7 dot 10^19$, $1.2 dot 10^21$,
    table.hline(stroke: 0.05em),
    [Transformer (base model)], [27.3], [38.1], table.cell(colspan: 2, $3.3 dot 10^18$),
    [Transformer (big)], [*28.4*], [*41.8*], table.cell(colspan: 2, $2.3 dot 10^19$),
    table.hline(stroke: 0.08em),
  ),
) <tab-mt>

On WMT 2014 English-to-French, the big model scores 41.8 BLEU, above every previously published single model, and it cost less than a quarter as much to train as the previous best.
For this language pair it used dropout $P_"drop" = 0.1$ instead of 0.3.

The weights evaluated for a base model were the mean of its last five checkpoints, saved every ten minutes; for a big model, the mean of its last 20.
Translations were decoded by beam search, with beam size 4 and length penalty $alpha = 0.6$ @wu2016google, both tuned on the development set.
Outputs could run to 50 tokens more than the input, but decoding ended as soon as the beam had finished @wu2016google.

The cost columns of @tab-mt estimate each model's training compute as #box($t times g times r$): the training time $t$, the number of GPUs $g$, and the sustained single-precision throughput $r$ of one GPU, taken as 2.8, 3.7, 6.0 and 9.5 TFLOPS for the K80, K40, M40 and P100.

== Model variations

To measure what each part of the model contributes, the base model was changed one way at a time and evaluated on the English-to-German development set, newstest2013 (@tab-variations).
Checkpoints were not averaged here; decoding was otherwise as above.

#figure(
  caption: [
    Variations on the base model, evaluated on English-to-German newstest2013 (development set).
    Blank cells keep the base model's value.
    Perplexities (PPL) are per word-piece under the byte-pair encoding and are not comparable with per-word perplexities.
    From @vaswani2017attention[Table 3].
  ],
  placement: top,
  {
    set text(size: 8.5pt)
    table(
      columns: 13,
      align: (left, ..range(12).map(_ => center)),
      stroke: none,
      inset: (x: 3.4pt, y: 2.6pt),
      table.hline(stroke: 0.08em),
      table.header(
        [],
        $N$,
        $d_"model"$,
        $d_"ff"$,
        $h$,
        $d_k$,
        $d_v$,
        $P_"drop"$,
        $epsilon_"ls"$,
        [Train \ steps],
        [PPL \ (dev)],
        [BLEU \ (dev)],
        [Params \ $times 10^6$],
      ),
      table.hline(stroke: 0.05em),
      [base], [6], [512], [2048], [8], [64], [64], [0.1], [0.1], [100K], [4.92], [25.8], [65],
      table.hline(stroke: 0.05em),
      table.cell(rowspan: 4, align: horizon)[(A)], [], [], [], [1], [512], [512], [], [], [], [5.29], [24.9], [],
      [], [], [], [4], [128], [128], [], [], [], [5.00], [25.5], [],
      [], [], [], [16], [32], [32], [], [], [], [4.91], [25.8], [],
      [], [], [], [32], [16], [16], [], [], [], [5.01], [25.4], [],
      table.hline(stroke: 0.05em),
      table.cell(rowspan: 2, align: horizon)[(B)], [], [], [], [], [16], [], [], [], [], [5.16], [25.1], [58],
      [], [], [], [], [32], [], [], [], [], [5.01], [25.4], [60],
      table.hline(stroke: 0.05em),
      table.cell(rowspan: 7, align: horizon)[(C)], [2], [], [], [], [], [], [], [], [], [6.11], [23.7], [36],
      [4], [], [], [], [], [], [], [], [], [5.19], [25.3], [50],
      [8], [], [], [], [], [], [], [], [], [4.88], [25.5], [80],
      [], [256], [], [], [32], [32], [], [], [], [5.75], [24.5], [28],
      [], [1024], [], [], [128], [128], [], [], [], [4.66], [26.0], [168],
      [], [], [1024], [], [], [], [], [], [], [5.12], [25.4], [53],
      [], [], [4096], [], [], [], [], [], [], [4.75], [26.2], [90],
      table.hline(stroke: 0.05em),
      table.cell(rowspan: 4, align: horizon)[(D)], [], [], [], [], [], [], [0.0], [], [], [5.77], [24.6], [],
      [], [], [], [], [], [], [0.2], [], [], [4.95], [25.5], [],
      [], [], [], [], [], [], [], [0.0], [], [4.67], [25.3], [],
      [], [], [], [], [], [], [], [0.2], [], [5.47], [25.7], [],
      table.hline(stroke: 0.05em),
      [(E)], table.cell(colspan: 8)[learned positional embedding instead of sinusoids], [], [4.92], [25.7], [],
      table.hline(stroke: 0.05em),
      [big], [6], [1024], [4096], [16], [], [], [0.3], [], [300K], [*4.33*], [*26.4*], [213],
      table.hline(stroke: 0.08em),
    )
  },
) <tab-variations>

Rows (A) vary the number of heads and the key and value sizes while holding the amount of computation fixed (@sec-multihead).
With one head, BLEU is 0.9 below the best setting, and with 32 heads it is 0.4 below, so too many heads hurt as well.
Shrinking the key size $d_k$ (rows B) costs up to 0.7 BLEU, a hint that scoring compatibility is harder than a dot product makes it look, and that a richer compatibility function might pay off.
Bigger models do better (rows C), and turning dropout off costs 1.2 BLEU (rows D), so regularization matters at this scale.
Replacing the sinusoids with learned positional embeddings @gehring2017convolutional (row E) changes BLEU by only 0.1.

== English constituency parsing

To see whether the Transformer carries over to other tasks, it was also applied to English constituency parsing.
Parsing is hard in its own ways: a parse tree must satisfy strict structural rules, and written out as a sequence it is far longer than the sentence it describes.
Recurrent sequence-to-sequence models had also fallen short of the state of the art when training data is scarce @vinyals2015grammar.

#figure(
  caption: [
    English constituency parsing: F1 on Section 23 of the Wall Street Journal (WSJ) part of the Penn Treebank.
    From @vaswani2017attention[Table 4].
  ],
  placement: top,
  table(
    columns: 3,
    align: (left, left, center),
    stroke: none,
    inset: (x: 5pt, y: 3.5pt),
    table.hline(stroke: 0.08em),
    table.header([Parser], [Training], [WSJ 23 F1]),
    table.hline(stroke: 0.05em),
    [Vinyals, Kaiser et al. (2015) @vinyals2015grammar], [WSJ only, discriminative], [88.3],
    [Petrov et al. (2006) @petrov2006learning], [WSJ only, discriminative], [90.4],
    [Zhu et al. (2013) @zhu2013fast], [WSJ only, discriminative], [90.4],
    [Dyer et al. (2016) @dyer2016recurrent], [WSJ only, discriminative], [91.7],
    [Transformer (4 layers)], [WSJ only, discriminative], [91.3],
    table.hline(stroke: 0.05em),
    [Zhu et al. (2013) @zhu2013fast], [semi-supervised], [91.3],
    [Huang and Harper (2009) @huang2009self], [semi-supervised], [91.3],
    [McClosky et al. (2006) @mcclosky2006effective], [semi-supervised], [92.1],
    [Vinyals, Kaiser et al. (2015) @vinyals2015grammar], [semi-supervised], [92.1],
    [Transformer (4 layers)], [semi-supervised], [92.7],
    table.hline(stroke: 0.05em),
    [Luong et al. (2015) @luong2015multi], [multi-task], [93.0],
    [Dyer et al. (2016) @dyer2016recurrent], [generative], [93.3],
    table.hline(stroke: 0.08em),
  ),
) <tab-parsing>

A Transformer with 4 layers and $d_"model" = 1024$ was trained on the roughly 40K training sentences of the WSJ part of the Penn Treebank @marcus1993building.
It was also trained semi-supervised, adding the high-confidence and BerkeleyParser corpora of about 17M sentences @vinyals2015grammar.
Vocabularies had 16K tokens for WSJ-only training and 32K for semi-supervised training.
A few experiments, with Section 22 as the development set, chose the dropout on attention and residual connections (@sec-training), the learning rate and the beam size; everything else was kept from the English-to-German base model.
Decoding allowed outputs up to 300 tokens longer than the input, and used beam size 21 with #box($alpha = 0.3$) in both settings.

With almost no tuning for the task, the Transformer parses well (@tab-parsing).
Trained on WSJ alone it reaches 91.3 F1, behind only the discriminative recurrent neural network grammar @dyer2016recurrent at 91.7.
With semi-supervised data it reaches 92.7, above the other semi-supervised parsers; only the multi-task model of @luong2015multi (93.0) and the generative recurrent neural network grammar (93.3) score higher.
Recurrent sequence-to-sequence models trained on the 40K WSJ sentences fell short of the BerkeleyParser @petrov2006learning, with 88.3 F1 against its 90.4 @vinyals2015grammar; the Transformer, trained on the same sentences, beats it.

= Conclusion <sec-conclusion>

Replacing recurrence with multi-head self-attention gives an encoder--decoder model whose layers process all positions at once.
For translation it beats the recurrent and convolutional systems it was compared with for less training compute (@tab-mt), and on WMT 2014 it set new best scores for both English-to-German and English-to-French, the former above every earlier ensemble.
The same architecture, lightly tuned, is also a competitive constituency parser.

The authors planned to apply attention-only models to more tasks, including ones whose inputs and outputs are not text, like images, audio and video, where local, restricted attention could keep long inputs affordable.
They also hoped to make generation less dependent on producing one token after another.
Their code for training and evaluating the models is at #url("https://github.com/tensorflow/tensor2tensor").

#heading(numbering: none)[Acknowledgments]

In the original paper, the authors thank Nal Kalchbrenner and Stephan Gouws for feedback, corrections and inspiration.
