# Postgres Explorer Desktop App

> Sibling of the SQLite Explorer (`sqliteviewer`): identical UI and architecture,
> retargeted to PostgreSQL. The pure-Rust core crate is `pgcore`; it talks to the
> server with the `postgres` client over an r2d2 pool (native-tls for SSL).

## Mission

Build a fast, beautiful PostgreSQL desktop application using:

* Tauri 2
* React
* TypeScript
* Rust
* postgres (rust-postgres) + r2d2
* TanStack Table
* TailwindCSS
* Monaco Editor

The application should feel closer to TablePlus than pgAdmin.

Primary goals:

1. Extremely fast startup
2. Extremely fast table browsing
3. Large database support
4. Modern UI
5. Local-first
6. No telemetry
7. No cloud features
8. No Electron
9. Native-feeling experience

---

# Product Vision

This application is a visual query builder and PostgreSQL explorer.

Users should be able to:

* Connect to PostgreSQL databases
* Browse schemas
* Browse tables
* Browse views
* Browse indexes
* Browse triggers
* Inspect columns
* Inspect row counts
* Search data
* Filter data
* Sort data
* Join tables
* Generate SQL visually
* View generated SQL
* Edit generated SQL manually
* Export results

The user should rarely need to write SQL.

The UI should generate SQL automatically.

Generated SQL must always remain visible.

---

# User Experience Principles

## Principle 1

Never freeze the UI.

All database work runs in Rust.

React never directly touches PostgreSQL.

---

## Principle 2

Never load entire tables.

Always paginate.

Bad:

SELECT * FROM users

Good:

SELECT * FROM users
LIMIT 500
OFFSET 0

---

## Principle 3

Show SQL at all times.

Every visual operation must produce SQL.

Example:

User adds filter:

Age > 25

Display:

SELECT *
FROM users
WHERE age > 25

---

## Principle 4

Schema Discovery Must Be Instant

Immediately show:

* Tables
* Views
* Indexes
* Triggers

Use information_schema / pg_catalog.

---

## Principle 5

Large Database Friendly

Target:

* 1M rows
* 10M rows
* 100M rows

Without crashing.

---

# Required Features

## Connecting

Connect via a form with saved profiles:

* host
* port
* database
* user
* password
* SSL mode (disable / prefer / require)

Display:

* host:port / database
* database size
* server version

---

# Sidebar

Sidebar contains:

## Tables

Display:

* table name
* row count

Example:

Users (2,431)
Orders (5,223)
Products (183)

Row counts should be cached.

---

## Views

Display all views.

---

## Indexes

Display all indexes.

---

## Triggers

Display all triggers.

---

# Table Browser

When selecting a table:

Display:

* column names
* column types
* row count
* primary key
* foreign keys

---

# Data Grid

Requirements:

* Virtualized rendering
* Infinite scrolling
* Pagination
* Column resizing
* Column sorting
* Multi-column sorting
* Copy cell
* Copy row
* Copy selection

---

# Search Builder

User should not need SQL knowledge.

Provide visual filtering.

Supported operators:

* Equals
* Not Equals
* Greater Than
* Greater Than Or Equal
* Less Than
* Less Than Or Equal
* Like
* Not Like
* Starts With
* Ends With
* Contains
* Not Contains
* IN
* NOT IN
* IS NULL
* IS NOT NULL
* BETWEEN

Examples:

Name LIKE '%john%'
Age > 25
Country IN ('US','CA')

---

# Compound Filters

Support:

AND

OR

Nested Groups

Example:

(Age > 18 AND Country='US')
OR
(Role='Admin')

---

# SQL Preview Panel

Always visible.

Every visual action updates SQL.

Example:

SELECT *
FROM users
WHERE age > 25
ORDER BY created_at DESC
LIMIT 500

User may:

* Copy SQL
* Edit SQL
* Execute SQL

---

# Join Builder

Visual join creation.

Support:

INNER JOIN

LEFT JOIN

RIGHT JOIN

FULL OUTER JOIN

CROSS JOIN

User workflow:

1. Select table
2. Add join
3. Select foreign key
4. Select target table

Generated SQL visible immediately.

Example:

SELECT *
FROM orders
INNER JOIN users
ON users.id = orders.user_id

---

# Query Builder

Visual query generation.

Support:

SELECT

WHERE

GROUP BY

HAVING

ORDER BY

LIMIT

OFFSET

JOINS

DISTINCT

Aliases

Aggregations

COUNT

SUM

AVG

MIN

MAX

---

# Query History

Store recent queries.

Display:

* timestamp
* execution time
* query text

---

# Performance Requirements

Target:

Database Open:
<100ms

Table Switch:
<100ms

Filter Update:
<100ms

Pagination:
<50ms

Scroll:
60fps

---

# Rust Backend Responsibilities

Rust owns:

* PostgreSQL connection
* Query execution
* Pagination
* Metadata
* Schema discovery
* Query planning
* Exporting

Frontend never executes SQL directly.

---

# Pagination Strategy

Use:

LIMIT
OFFSET

For large tables optionally support:

Keyset Pagination

Example:

WHERE id > ?
ORDER BY id

---

# Exporting

Support:

CSV

JSON

Excel

Export:

Current Page

Filtered Results

Entire Query Result

---

# Safety

Never execute destructive queries automatically.

Block visual builder from generating:

DROP TABLE

DROP DATABASE

DELETE without confirmation

UPDATE without confirmation

VACUUM confirmation required

---

# UI Style

Visual inspiration:

* TablePlus
* Linear
* Raycast
* Supabase Studio
* Arc Browser

Design:

* Clean spacing
* Minimal chrome
* Dark mode first
* Rounded corners
* Keyboard driven

---

# Keyboard Shortcuts

Cmd/Ctrl + O

Open Database

Cmd/Ctrl + F

Search

Cmd/Ctrl + L

Focus SQL

Cmd/Ctrl + Enter

Run Query

Cmd/Ctrl + K

Command Palette

---

# Architecture

Frontend

React
TypeScript
TanStack Table
Tailwind

Backend

Tauri
Rust
postgres (rust-postgres)

Communication

Tauri Commands

No HTTP layer.

---

# Success Criteria

A user should be able to:

1. Connect to a PostgreSQL database
2. View tables
3. View row counts
4. View schema
5. Filter data visually
6. Generate SQL visually
7. Build joins visually
8. Export results
9. Browse millions of rows smoothly

without writing SQL.
