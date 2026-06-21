ALTER TABLE "Page"
ADD COLUMN "notes" TEXT,
ADD COLUMN "quality" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'offen';

ALTER TABLE "Stamp"
ADD COLUMN "notes" TEXT,
ADD COLUMN "positionHint" TEXT,
ADD COLUMN "manualCountryHint" TEXT,
ADD COLUMN "manualConditionHint" TEXT,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'unanalysiert';

CREATE INDEX "Page_status_idx" ON "Page"("status");
CREATE INDEX "Stamp_status_idx" ON "Stamp"("status");
