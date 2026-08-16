-- CreateEnum
CREATE TYPE "PieceFormat" AS ENUM ('carrossel', 'reels', 'estatico', 'stories');

-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('draft', 'approved', 'published', 'failed');

-- CreateTable
CREATE TABLE "Piece" (
    "id" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "format" "PieceFormat" NOT NULL,
    "caption" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "imageUrl" TEXT,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "status" "PieceStatus" NOT NULL DEFAULT 'draft',
    "igMediaId" TEXT,
    "igPermalink" TEXT,
    "metrics" JSONB,
    "claimCheckPassed" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Piece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Piece_status_publishAt_idx" ON "Piece"("status", "publishAt");

-- CreateIndex
CREATE INDEX "Piece_pillar_segment_format_publishAt_idx" ON "Piece"("pillar", "segment", "format", "publishAt");
