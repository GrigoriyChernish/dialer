-- Час, до якого користувач переглянув історію (мс): від нього рахується лічильник пропущених на всіх пристроях (docs/signaling.md, `recents.seen`).
ALTER TABLE users ADD COLUMN recents_seen_up_to INTEGER NOT NULL DEFAULT 0;
