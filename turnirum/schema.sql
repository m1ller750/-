CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    full_name     TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('organizer', 'participant', 'creator')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tournaments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    organizer_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title         TEXT    NOT NULL,
    game          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    format        TEXT    NOT NULL DEFAULT 'online' CHECK (format IN ('online', 'offline')),
    city          TEXT    NOT NULL DEFAULT '',
    start_at      TEXT    NOT NULL,
    max_teams     INTEGER NOT NULL DEFAULT 16,
    team_size     INTEGER NOT NULL DEFAULT 5,
    is_paid       INTEGER NOT NULL DEFAULT 0,
    entry_fee     INTEGER NOT NULL DEFAULT 0,
    card_number   TEXT,
    prize_percent INTEGER NOT NULL DEFAULT 60,
    prize_note    TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'registration'
                  CHECK (status IN ('registration', 'active', 'finished')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    captain_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    name          TEXT    NOT NULL,
    members       TEXT    NOT NULL DEFAULT '',
    wins          INTEGER NOT NULL DEFAULT 0,
    draws         INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    score_for     INTEGER NOT NULL DEFAULT 0,
    score_against INTEGER NOT NULL DEFAULT 0,
    points        INTEGER NOT NULL DEFAULT 0,
    is_paid       INTEGER NOT NULL DEFAULT 0,
    payment_note  TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tournament_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_organizer ON tournaments (organizer_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status);
CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams (tournament_id);
CREATE INDEX IF NOT EXISTS idx_teams_captain ON teams (captain_id);
