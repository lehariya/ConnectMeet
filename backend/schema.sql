CREATE TABLE IF NOT EXISTS meetings (
    room_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    host_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    ended INTEGER NOT NULL DEFAULT 0
);
