-- AlterTable
ALTER TABLE "Piece" ADD COLUMN     "imageGenAt" TIMESTAMP(3),
ADD COLUMN     "imageGenError" TEXT,
ADD COLUMN     "imageGenStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "imagePrompts" TEXT[] DEFAULT ARRAY[]::TEXT[];
