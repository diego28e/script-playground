-- Practice tasks written before this change kept the writing model's rating (-1 easy .. 1 hard, 0 typical) as their
-- difficulty. lk-practice reads difficulty in logits against a newcomer's ability (0), and plans for 85% success,
-- which is -1.73: a typical task belongs at -1.73 (lib/practice/tasks.ts toItemDifficulty). This rescales every task
-- that exists when it runs, which is before the code that writes the new scale is deployed, so each task is converted
-- exactly once: difficulty = clamp(rating, -1.5, 1.5) * 0.8 - 1.73, in the column and in the stored lk-practice item.
UPDATE "practice_task"
SET "difficulty" = ROUND((GREATEST(LEAST("difficulty", 1.5), -1.5) * 0.8 - 1.73)::numeric, 2);

UPDATE "practice_task"
SET "item" = jsonb_set("item", '{difficulty}', to_jsonb("difficulty"))
WHERE "item" IS NOT NULL;
