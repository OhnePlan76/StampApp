CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Stamp" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "cropUrl" TEXT NOT NULL,
    "country" TEXT,
    "era" TEXT,
    "denomination" TEXT,
    "motive" TEXT,
    "usedState" TEXT,
    "condition" TEXT,
    "catalogHint" TEXT,
    "confidence" DOUBLE PRECISION,
    "valueClass" INTEGER,
    "valueMin" DOUBLE PRECISION,
    "valueMax" DOUBLE PRECISION,
    "needsExpert" BOOLEAN NOT NULL DEFAULT false,
    "analysisRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Stamp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Page_albumId_pageNo_key" ON "Page"("albumId", "pageNo");
CREATE INDEX "Page_albumId_idx" ON "Page"("albumId");
CREATE INDEX "Stamp_pageId_idx" ON "Stamp"("pageId");
CREATE INDEX "Stamp_valueClass_needsExpert_idx" ON "Stamp"("valueClass", "needsExpert");

ALTER TABLE "Page" ADD CONSTRAINT "Page_albumId_fkey"
FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_pageId_fkey"
FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
