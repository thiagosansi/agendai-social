-- CreateTable
CREATE TABLE "PieceImage" (
    "id" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PieceImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PieceImage_pieceId_sortOrder_idx" ON "PieceImage"("pieceId", "sortOrder");

-- AddForeignKey
ALTER TABLE "PieceImage" ADD CONSTRAINT "PieceImage_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "Piece"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: preserve every existing Piece.imageUrl as its single PieceImage
-- (sortOrder 0) BEFORE the column is dropped below — zero data loss for
-- pieces (including production drafts a founder may already be uploading
-- images to at the time this migration runs).
INSERT INTO "PieceImage" ("id", "pieceId", "url", "sortOrder", "createdAt")
SELECT gen_random_uuid()::text, "id", "imageUrl", 0, CURRENT_TIMESTAMP
FROM "Piece"
WHERE "imageUrl" IS NOT NULL;

-- AlterTable
ALTER TABLE "Piece" DROP COLUMN "imageUrl";
