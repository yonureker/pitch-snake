-- Optional, one-time. Survival scores mean seconds survived from engine v15
-- on; rows from the points era are apples next to those oranges and would sit
-- on top of the board for ever. Run once in the SQL editor (same project as
-- leaderboard.sql) to clear the survival board and let the clock start
-- honest. Tournament boards are left alone: their windows expire on their own.
delete from public.pitch_snake_scores where mode = 'survival';
