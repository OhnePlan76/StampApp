ALTER TABLE "Album" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'erfassung';

ALTER TABLE "Page" ADD COLUMN "analysisStatus" TEXT NOT NULL DEFAULT 'wartet';
ALTER TABLE "Page" ADD COLUMN "analysisNotes" TEXT;
ALTER TABLE "Page" ADD COLUMN "detectedRegions" JSONB;
ALTER TABLE "Page" ADD COLUMN "analysisRaw" JSONB;

CREATE INDEX "Album_status_idx" ON "Album"("status");
CREATE INDEX "Page_analysisStatus_idx" ON "Page"("analysisStatus");
