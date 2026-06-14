-- 0001_extensions — enable pgvector for embedding columns (BGE-small, 384-dim).
-- Locked first: all schema builds on this.

create extension if not exists vector;
