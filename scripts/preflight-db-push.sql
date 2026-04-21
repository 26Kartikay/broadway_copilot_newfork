-- No-op preflight for `prisma db execute` in Docker entrypoints.
-- Product.handleId is part of the current schema; legacy DROP statements were removed.
SELECT 1;
