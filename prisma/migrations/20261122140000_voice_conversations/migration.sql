-- Conversations with the voice teachers (docs/voice-context.md): what a learner and the lesson tutor or the practice
-- coach said, kept so the learner can come back to it and so the teacher's context is built on the server.

-- CreateTable
CREATE TABLE "voice_conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "summarySeq" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_conversation_userId_kind_lessonId_updatedAt_idx" ON "voice_conversation"("userId", "kind", "lessonId", "updatedAt");

-- CreateIndex
CREATE INDEX "voice_conversation_userId_kind_courseId_updatedAt_idx" ON "voice_conversation"("userId", "kind", "courseId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "voice_message_conversationId_seq_key" ON "voice_message"("conversationId", "seq");

-- AddForeignKey
ALTER TABLE "voice_conversation" ADD CONSTRAINT "voice_conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_message" ADD CONSTRAINT "voice_message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "voice_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
