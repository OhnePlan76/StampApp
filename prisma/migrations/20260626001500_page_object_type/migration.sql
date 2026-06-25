ALTER TABLE "Page" ADD COLUMN "objectType" TEXT NOT NULL DEFAULT 'albumseite';

CREATE INDEX "Page_objectType_idx" ON "Page"("objectType");
