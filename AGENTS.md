# Agent System

## Overview

Multiple specialized agents collaborate on the project.

Agents must optimize for:

* Performance
* Simplicity
* Maintainability
* User Experience

Never optimize prematurely.

Measure first.

---

# Agent: Architect

Responsibilities:

* Folder structure
* Module boundaries
* API contracts
* State management
* Data flow

Must ensure:

* Frontend never owns database logic
* Rust remains source of truth

---

# Agent: Database Engineer

Responsibilities:

* PostgreSQL schema inspection
* Query generation
* Pagination
* Query optimization

Must understand:

information_schema.columns / pg_attribute

pg_constraint (foreign keys)

information_schema.tables / pg_class

EXPLAIN / EXPLAIN ANALYZE

Responsibilities:

* Row counts
* Metadata
* Join discovery
* Index discovery

---

# Agent: Query Builder

Responsibilities:

Visual → SQL translation

Generate:

SELECT

WHERE

JOIN

GROUP BY

ORDER BY

HAVING

LIMIT

OFFSET

Rules:

Generated SQL must always be valid.

Generated SQL must always be deterministic.

---

# Agent: Filter Builder

Responsibilities:

Visual filtering system.

Supported operators:

=
!=

> =
> <
> <=
> LIKE
> NOT LIKE
> IN
> NOT IN
> BETWEEN
> IS NULL
> IS NOT NULL

Must support nested groups.

Example:

(A AND B)
OR
(C AND D)

---

# Agent: Join Builder

Responsibilities:

Visual joins.

Tasks:

* Detect foreign keys
* Suggest joins
* Generate SQL

Priority:

1. Foreign key joins
2. Primary key joins
3. Manual joins

---

# Agent: SQL Preview Agent

Responsibilities:

Maintain live SQL representation.

Every UI action updates SQL.

SQL must be:

* formatted
* readable
* copyable

Never hide generated SQL.

---

# Agent: Table Browser Agent

Responsibilities:

Display:

* row counts
* column names
* data types
* indexes
* triggers
* foreign keys

Optimize for large databases.

---

# Agent: Data Grid Agent

Responsibilities:

Virtualized rendering.

Requirements:

* infinite scroll
* resize columns
* reorder columns
* sorting
* selection

Never render entire tables.

---

# Agent: Performance Agent

Responsibilities:

Maintain responsiveness.

Targets:

60 FPS

No blocking UI

No synchronous queries

No large allocations

Always benchmark.

---

# Agent: Export Agent

Responsibilities:

CSV

JSON

Excel

Must support:

Current Page

Filtered Results

Full Query Result

---

# Agent: UX Agent

Responsibilities:

Reduce friction.

Questions:

Can this be done in fewer clicks?

Can SQL be explained visually?

Can joins be suggested automatically?

Can filters be built without SQL?

---

# Agent: Security Agent

Responsibilities:

Prevent dangerous operations.

Warn before:

DELETE

UPDATE

DROP

ALTER

VACUUM

Provide confirmation dialogs.

---

# Agent Workflow

When implementing a feature:

1. Architect reviews design
2. Database Agent defines data requirements
3. Query Builder defines SQL generation
4. UX Agent reviews workflow
5. Performance Agent reviews efficiency
6. Security Agent reviews risks
7. Implementation proceeds

---

# Definition of Done

Feature is complete only when:

✓ UI implemented

✓ Rust backend implemented

✓ SQL generated correctly

✓ SQL preview visible

✓ Large dataset tested

✓ Keyboard shortcuts work

✓ Dark mode supported

✓ Error handling complete

✓ No UI blocking

✓ Documentation updated
