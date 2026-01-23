-- AlterTable
ALTER TABLE "join_intents" ADD COLUMN     "onChainRoomId" TEXT;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "roomId" TEXT;

-- CreateIndex
CREATE INDEX "join_intents_onChainRoomId_idx" ON "join_intents"("onChainRoomId");

-- CreateIndex
CREATE INDEX "matches_roomId_idx" ON "matches"("roomId");
