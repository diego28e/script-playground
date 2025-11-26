-- Convert description from TEXT to JSONB while preserving data
ALTER TABLE "challenge" 
ALTER COLUMN "description" TYPE JSONB 
USING jsonb_build_object('en', "description", 'es', '');
