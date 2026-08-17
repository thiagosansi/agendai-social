-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitors" JSONB NOT NULL,
    "hashtags" JSONB NOT NULL,
    "hashtagsQueried" TEXT[],
    "errors" JSONB NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSnapshot_createdAt_idx" ON "MarketSnapshot"("createdAt");
