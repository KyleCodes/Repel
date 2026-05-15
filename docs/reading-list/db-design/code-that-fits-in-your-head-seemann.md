# Code That Fits in Your Head — Mark Seemann (2021)

**Book.** ISBN 978-0-13-746440-1.

General software-engineering book, but two threads matter for DB design. First, Seemann's framing of "fractal architecture" — a function should fit in your head, and the way to make a feature fit is to push I/O to the edges and keep the decision in one readable block. Same idea as Bernhardt's functional core but worked out in detail with examples.

Second, his treatment of validation and parsing at the boundary: parse once at the edge, hand typed values inward, never re-validate. Maps directly onto the "parse the request → run one query → return" shape of vertical slices.

Light on SQL specifics — read it for the design principles that justify _why_ the flow-shaped service is easier to reason about than the layered one. The companion blog (https://blog.ploeh.dk/) has many shorter posts in the same vein.
