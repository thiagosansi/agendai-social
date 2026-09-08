-- AlterTable
ALTER TABLE "Piece" ADD COLUMN     "overlayText" TEXT,
ADD COLUMN     "overlayTexts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PieceImage" ADD COLUMN     "sourceUrl" TEXT;
