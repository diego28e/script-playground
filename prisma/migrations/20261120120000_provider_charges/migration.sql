-- Voice spend (docs/voice-spend.md): one row per billable call to ElevenLabs or Deepgram.

-- CreateTable
CREATE TABLE "provider_charge" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "workload" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "characters" INTEGER NOT NULL DEFAULT 0,
    "audioSeconds" DOUBLE PRECISION,
    "estimatedMicros" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "runtime" TEXT NOT NULL,
    "userId" TEXT,
    "courseId" TEXT,
    "lessonId" TEXT,
    "audioId" TEXT,
    "videoPartId" TEXT,
    "voice" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_charge_createdAt_idx" ON "provider_charge"("createdAt");

-- CreateIndex
CREATE INDEX "provider_charge_provider_createdAt_idx" ON "provider_charge"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "provider_charge_requestId_idx" ON "provider_charge"("requestId");


-- Backfill: the voice calls already counted in the AI ledger (ai_request), so this month's report is complete. Those
-- rows were written per lesson voiced or per tutor reply, without the provider's request ids.
INSERT INTO "provider_charge" ("id", "provider", "workload", "model", "status", "characters", "estimatedMicros", "runtime", "userId", "detail", "createdAt")
SELECT
    'bf_' || "id",
    CASE WHEN "model" LIKE 'elevenlabs%' THEN 'elevenlabs' ELSE 'deepgram' END,
    CASE
        WHEN "model" IN ('elevenlabs-v4-narration', 'deepgram-aura-2-narration') THEN 'lesson-audio.voice'
        WHEN "model" = 'deepgram-aura-2' THEN 'tutor.speak'
        ELSE 'tutor.listen'
    END,
    CASE
        WHEN "model" = 'elevenlabs-v4-narration' THEN 'eleven_v4'
        WHEN "model" IN ('deepgram-aura-2-narration', 'deepgram-aura-2') THEN 'aura-2'
        WHEN "model" = 'deepgram-flux-multi' THEN 'flux-general-multi'
        ELSE 'nova-3'
    END,
    CASE WHEN "status" = 'FAILED' THEN 'failed' ELSE 'ok' END,
    "inputTokens",
    "listCostMicros",
    CASE WHEN "feature" = 'narrate' THEN 'worker' ELSE 'lab' END,
    "userId",
    jsonb_build_object('backfilledFrom', 'ai_request', 'aiRequestId', "id"),
    "createdAt"
FROM "ai_request"
WHERE "model" IN ('elevenlabs-v4-narration', 'deepgram-aura-2-narration', 'deepgram-aura-2', 'deepgram-flux-multi', 'deepgram-nova-3-multi');
