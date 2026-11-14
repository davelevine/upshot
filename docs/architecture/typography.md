# Typography

Upshot uses two type families, and which one you're reading tells you whose words they are. This page covers the split, how the fonts were tuned, and how they get to the page without sitting in a public repo.

## Whose words they are

Articles are set in Mercury Text, with their headline in Mercury Display, its cut for large sizes. Everything else, from the upshot to the story list, is in Söhne. The publisher's words are in Mercury; Upshot's own are in Söhne.

## Where the fonts live

All three are licensed, so they can't sit in this public repo. They live in a private R2 bucket, `upshot-fonts`, and the Worker serves them on the site's own origin under `/fonts/licensed/`.

- **The paths have no extension**, so the Worker runs for them.
- **The Worker answers only for `.woff2` files**, with a CORS header that admits the reader frame but not other sites.
- **Without the bucket, as in a fork,** the site uses the system sans and serif. [Optional setup](../setup/optional.md) covers adding your own.

Public Sans stays in `fonts/`, outside the site, for the one thing the build draws itself: `og.png`, the link preview.

## Tuning

- **Mercury grades.** Mercury Text comes in grades that differ only in darkness, at identical widths. The reader uses G2 in the light theme and the lighter G1 in the dark, where light text on a dark ground reads heavier. Since the widths match, switching themes never reflows a line.
- **Mercury's size.** Mercury's x-height is small (0.448 of the em), so its faces carry `size-adjust: 113%`.
- **Söhne's weights.** Söhne replaced Public Sans, and the weights the CSS asks for were tuned for Public Sans. Rather than retune everything, each Söhne face takes the range of weights whose rendered ink it matches: 370 and 500 Buch, 600 Kräftig, 700 Halbfett.
- **Söhne's width.** `size-adjust: 108%` sets Söhne as wide as Public Sans was, so lines break and clamp where they did.

## Cleaning H&Co's files

H&Co's Mercury files are cleaned before upload:

- **Mercury Text's CFF hints are removed**, because Firefox's font sanitizer rejected them.
- **The ffi and ffl ligatures are dropped** in both Text and Display. They sat at U+2248 and U+221A, so with them gone, ≈ and √ fall back to a font that has them.

## Getting fonts into the reader

The reader is a sandboxed frame, which the browser caches apart each time. Fonts loaded there by URL were downloaded again for every article, which wasn't great.

Instead, the page fetches each font once in the background after the list loads, cached as usual, and hands it to every frame inline as a `data:` URL. The page's CSP allows `data:` fonts for this.
