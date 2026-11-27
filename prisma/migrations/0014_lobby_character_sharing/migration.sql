ALTER TABLE "LobbyMember" ADD COLUMN "sharedCharacterId" TEXT;
ALTER TABLE "LobbyMember" ADD COLUMN "shareRequestId" TEXT;
ALTER TABLE "LobbyMember" ADD COLUMN "shareApproved" BOOLEAN NOT NULL DEFAULT false;
