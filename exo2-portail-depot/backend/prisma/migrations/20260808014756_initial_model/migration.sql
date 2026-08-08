-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'complete', 'failed');

-- CreateTable
CREATE TABLE "Lawyer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lawyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositRequest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lawyerId" TEXT NOT NULL,

    CONSTRAINT "DepositRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "requestId" TEXT NOT NULL,

    CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestedItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,

    CONSTRAINT "RequestedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedItemId" TEXT NOT NULL,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lawyer_email_key" ON "Lawyer"("email");

-- CreateIndex
CREATE INDEX "DepositRequest_lawyerId_idx" ON "DepositRequest"("lawyerId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicLink_tokenHash_key" ON "PublicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PublicLink_requestId_idx" ON "PublicLink"("requestId");

-- CreateIndex
CREATE INDEX "RequestedItem_requestId_idx" ON "RequestedItem"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_storageKey_key" ON "UploadedFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_requestedItemId_key" ON "UploadedFile"("requestedItemId");

-- AddForeignKey
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "Lawyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicLink" ADD CONSTRAINT "PublicLink_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DepositRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestedItem" ADD CONSTRAINT "RequestedItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DepositRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_requestedItemId_fkey" FOREIGN KEY ("requestedItemId") REFERENCES "RequestedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ajout manuel : Prisma ne sait pas exprimer un index conditionnel dans le
-- schema, et cette contrainte porte l'invariant central du lien public.
--
-- « Un seul lien actif par demande » : la contrainte ne s'applique qu'aux
-- lignes non revoquees, ce qui laisse l'historique s'accumuler librement. Sans
-- le WHERE, un index unique sur requestId interdirait tout historique ; sans
-- index du tout, deux liens actifs pourraient coexister sur la meme demande,
-- et un ancien PIN resterait valide — exactement ce que ce modele existe pour
-- rendre impossible.
--
-- A REPORTER si cette migration est un jour regeneree.
CREATE UNIQUE INDEX "PublicLink_requestId_active_key"
  ON "PublicLink" ("requestId") WHERE "revokedAt" IS NULL;
