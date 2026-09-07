# tools

Sources for artwork that is committed as an image but should never be redrawn
by hand.

## og-card.html

The social preview card, rendered to `assets/og.png`. Open it in a browser at
1200x630 and screenshot it, or drive it headless:

```bash
python3 -m http.server 8777
# then capture http://localhost:8777/tools/og-card.html at exactly 1200x630
```

The wordmark inside it is drawn to a canvas rather than laid out in CSS, and
that is the whole reason this file exists. The I of PITCH is a snake going
down, three segments with the head last, and it has to sit on the same cap
height as the letters beside it. CSS will not tell you where that is; canvas
will, because `measureText().actualBoundingBoxAscent` is the real ink top of
the glyph in that face at that size. Everything else in the mark is positioned
off that one measurement, so changing the type size moves the snake correctly
without any numbers being retuned.

`assets/icon.svg` is the same idea reduced to what survives 16px: the snake-I
alone on the pitch's green. It is hand-written SVG with no text in it, because
a favicon does not reliably get a webfont and a wordmark that falls back to
Helvetica has stopped being the logo.
