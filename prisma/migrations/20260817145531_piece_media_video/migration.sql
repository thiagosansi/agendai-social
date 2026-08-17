-- AlterTable
ALTER TABLE "Piece" ADD COLUMN     "pendingContainerCreatedAt" TIMESTAMP(3),
ADD COLUMN     "pendingContainerId" TEXT;

-- AlterTable
ALTER TABLE "PieceImage" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'image';
