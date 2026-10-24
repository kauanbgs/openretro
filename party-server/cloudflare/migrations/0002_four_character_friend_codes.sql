-- Keep existing four-character choices. Assign unused short defaults to legacy
-- codes without changing account IDs, sessions or relationship rows.
WITH RECURSIVE numbers(n) AS (
  SELECT 0
  UNION ALL SELECT n + 1 FROM numbers WHERE n + 1 < (SELECT COUNT(*) FROM users)
), candidates AS (
  SELECT n, 'jogador#' ||
    substr('0123456789abcdefghijklmnopqrstuvwxyz', ((n / 46656) % 36) + 1, 1) ||
    substr('0123456789abcdefghijklmnopqrstuvwxyz', ((n / 1296) % 36) + 1, 1) ||
    substr('0123456789abcdefghijklmnopqrstuvwxyz', ((n / 36) % 36) + 1, 1) ||
    substr('0123456789abcdefghijklmnopqrstuvwxyz', (n % 36) + 1, 1) AS code
  FROM numbers
), available AS MATERIALIZED (
  SELECT code, ROW_NUMBER() OVER (ORDER BY n) AS position FROM candidates
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE friend_code = candidates.code)
), legacy AS MATERIALIZED (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS position FROM users
  WHERE length(friend_code) - instr(friend_code, '#') <> 4
)
UPDATE users SET friend_code = available.code
FROM legacy JOIN available ON legacy.position = available.position
WHERE users.id = legacy.id;
