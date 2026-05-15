# Functional Core, Imperative Shell — Gary Bernhardt

**URL:** https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell

Screencast (and accompanying talk "Boundaries") arguing that an app should be a thin imperative shell that does I/O, wrapping a pure functional core that does decisions. The relevance to DB design: the shell decides _which_ SQL to run and what to do with the result; the core never reaches through a repository to fetch more data mid-decision. This kills the "service calls service calls repo" chains that produce the multi-round-trip transaction pattern.

In practice for a SQL backend: the handler reads everything it needs in one query (or one CTE), passes plain data to a pure function, takes the function's verdict, writes it back in one statement. Transactions stay short.

Talk version (free): https://www.destroyallsoftware.com/talks/boundaries
