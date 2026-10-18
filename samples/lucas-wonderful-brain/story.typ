// The story, one page at a time; the pictures are in illustrations/,
// numbered in story order. Each picture leaves open space (sky, a wall,
// grass) where its words go: at: top or bottom puts them there.
// Lines starting with // are notes to yourself and never appear in the book.
#import "style.typ": *

// Grown-ups on the left half, Grandma and the children on the right: each
// page's words sit in the open sky near the people they name.
#spread(
  picture: "illustrations/02-family.jpg",
  left: {
    words(at: top + right)[
      This is our family. \
      Here are Mommy \
      and Daddy.
    ]
    words(at: bottom + right)[
      Auntie Alvina helps \
      take care of us.
    ]
  },
  right: words(at: top + left)[
    Here are Luca and Summer. \
    Grandma comes all the way from Jamaica \
    to give them the biggest hugs!
  ],
)

#story-page(picture: "illustrations/03-luca.jpg")[
  This is Luca. \
  Luca is Summer's big brother.
]

#story-page(picture: "illustrations/04-summer.jpg")[
  This is Summer. \
  Summer is Luca's little sister.
]

#story-page(picture: "illustrations/05-autism.jpg")[
  Luca has autism. \
  Autism means Luca's brain works \
  in its own special way.
]

#story-page(picture: "illustrations/06-brains.jpg", at: top)[
  Everybody's brain is a little bit different. \
  Luca's body and brain need some different things \
  to feel calm and happy.
]

// Things Luca does, each with a page that says why.

#story-page(
  picture: "illustrations/07-chin.jpg",
  at: top,
  sounds: {
    sound("rub", x: 17.1%, y: 19.6%, angle: -14deg, size: 23pt)
    sound("rub", x: 22.7%, y: 25.8%, angle: -8deg, size: 26pt)
    sound("rub!", x: 28.4%, y: 32.5%, angle: -3deg, size: 30pt)
  },
)[
  Sometimes Luca rubs his chin on you.
]

#story-page(picture: "illustrations/08-chin-why.jpg")[
  Rubbing his chin helps Luca's body feel calm. \
  It's one of Luca's ways to feel okay.
]

#story-page(picture: "illustrations/09-sounds.jpg", at: top)[
  Luca makes big sounds. \
  Sometimes he shouts! \
  Sometimes he says, "Ooooo!"
]

#story-page(picture: "illustrations/10-sounds-why.jpg")[
  Making sounds helps Luca's body feel good. \
  Luca isn't being angry or naughty. \
  That's just how Luca's body works!
]

#story-page(picture: "illustrations/11-echo.jpg", at: top)[
  When Daddy asks, "Luca, do you want to run?" \
  Luca says, "Want to run!"
]

#story-page(picture: "illustrations/12-echo-why.jpg")[
  Luca says our words back to us. \
  That's one of the ways Luca talks. \
  "Want to run!" means, "Yes, I want to run!"
]

// Things Luca loves.

#spread(
  picture: "illustrations/13-run.jpg",
  left: words(at: top)[Luca loves to run!],
  right: words[
    Fast, fast, FASTER! \
    Can you catch him, Summer?
  ],
)

#story-page(picture: "illustrations/14-piggyback.jpg", at: top)[
  Luca loves riding on Daddy's shoulders. \
  Up, up, up!
]

#story-page(
  picture: "illustrations/15-laptop.jpg",
  sounds: {
    sound("tap", x: 59.3%, y: 53.6%, angle: -8deg, size: 20pt)
    sound("tap", x: 62.9%, y: 44.3%, angle: -3deg, size: 23pt)
    sound("tap!", x: 67%, y: 35.1%, angle: 3deg, size: 27pt)
  },
)[
  Luca loves his laptop toy.
]

#story-page(
  picture: "illustrations/16-gummies.jpg",
  at: top,
  sounds: {
    sound("yum", x: 40.7%, y: 39.7%, angle: -6deg, size: 22pt)
    sound("yum", x: 32.5%, y: 31%, angle: -10deg, size: 26pt)
    sound("YUM!", x: 23.8%, y: 21.7%, angle: -14deg, size: 32pt)
  },
)[
  Luca loves gummies.
]

#story-page(picture: "illustrations/17-prosciutto.jpg")[
  And Luca LOVES prosciutto! \
  Luca could eat it all day!
]

// Family.

#story-page(picture: "illustrations/18-summer-helper.jpg")[
  Summer loves playing with Luca. \
  And Luca loves his little sister.
]

#story-page(picture: "illustrations/19-grown-ups.jpg")[
  Mommy, Daddy, Grandma and Auntie Alvina \
  all love Luca very much. \
  All the grown ups on Team Luca!
]

#spread(
  picture: "illustrations/20-different.jpg",
  left: words(at: top)[Everybody is different.],
  right: words[
    And our family loves Luca \
    just the way he is.
  ],
)

#vignette-page(picture: "illustrations/21-favorites.jpg")[
  *Luca's favorite things*

  #grid(columns: 2, column-gutter: 1.6em, align: left)[
    - Running
    - Piggyback
    - His laptop
  ][
    - Gummies
    - Prosciutto
    - His family
  ]
]
