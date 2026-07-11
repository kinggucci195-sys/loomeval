/*
  Warnings:

  - Changed the type of `scope` on the `IngestionKey` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('TRACE_WRITE', 'ARTIFACT_WRITE', 'TRACE_READ', 'REPLAY_CREATE', 'EXPERIMENT_CREATE');

-- AlterTable
ALTER TABLE "IngestionKey" ADD COLUMN     "environmentScope" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
DROP COLUMN "scope",
ADD COLUMN     "scope" "ApiKeyScope" NOT NULL;
