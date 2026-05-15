# The Vietnam of Computer Science — Ted Neward (2006)

**URL:** https://web.archive.org/web/20220628015214/http://blogs.tedneward.com/post/the-vietnam-of-computer-science/

Long-form essay arguing object-relational mapping is a quagmire: easy to enter, no clean exit, partial successes that look like wins but accumulate into structural problems. Names the impedance mismatches concretely — identity, inheritance, transactions, partial-object loads, query expressivity — and walks through why each one degrades over time.

Worth reading because it gives you the vocabulary to articulate _why_ the repo-per-table → service-composition pattern fights you in SQL. Most of the failure modes Neward describes show up the moment a use case needs data from more than one table.

Old (2006), pre-dates modern type-safe query builders, so some of the doom is overstated for the Kysely/sqlc generation. The diagnosis still lands; the prognosis is less bleak now.
