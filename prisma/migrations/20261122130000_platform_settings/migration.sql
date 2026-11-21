-- Platform settings (lib/settings.ts): what an admin sets for the whole platform from the dashboard, one row per key.
-- First used for the AI explainers' voice (docs/voice.md, "The explainer's voice").

-- CreateTable
CREATE TABLE "platform_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("key")
);
