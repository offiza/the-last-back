-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "join_intents" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "playerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "stake" DECIMAL(18,9) NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "join_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_txs" (
    "id" TEXT NOT NULL,
    "joinIntentId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" DECIMAL(18,9) NOT NULL,
    "status" TEXT NOT NULL,
    "blockNumber" BIGINT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_txs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "joinIntentId" TEXT NOT NULL,
    "txHash" TEXT,
    "amount" DECIMAL(18,9) NOT NULL,
    "toAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_playerId_key" ON "wallets"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_playerId_idx" ON "wallets"("playerId");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "join_intents_nonce_key" ON "join_intents"("nonce");

-- CreateIndex
CREATE INDEX "join_intents_playerId_status_idx" ON "join_intents"("playerId", "status");

-- CreateIndex
CREATE INDEX "join_intents_nonce_idx" ON "join_intents"("nonce");

-- CreateIndex
CREATE INDEX "join_intents_status_expiresAt_idx" ON "join_intents"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "join_intents_walletId_idx" ON "join_intents"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_txs_joinIntentId_key" ON "deposit_txs"("joinIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_txs_txHash_key" ON "deposit_txs"("txHash");

-- CreateIndex
CREATE INDEX "deposit_txs_txHash_idx" ON "deposit_txs"("txHash");

-- CreateIndex
CREATE INDEX "deposit_txs_fromAddress_idx" ON "deposit_txs"("fromAddress");

-- CreateIndex
CREATE INDEX "deposit_txs_toAddress_idx" ON "deposit_txs"("toAddress");

-- CreateIndex
CREATE INDEX "deposit_txs_status_idx" ON "deposit_txs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_joinIntentId_key" ON "refunds"("joinIntentId");

-- CreateIndex
CREATE INDEX "refunds_joinIntentId_idx" ON "refunds"("joinIntentId");

-- CreateIndex
CREATE INDEX "refunds_txHash_idx" ON "refunds"("txHash");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- AddForeignKey
ALTER TABLE "join_intents" ADD CONSTRAINT "join_intents_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_intents" ADD CONSTRAINT "join_intents_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_txs" ADD CONSTRAINT "deposit_txs_joinIntentId_fkey" FOREIGN KEY ("joinIntentId") REFERENCES "join_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_joinIntentId_fkey" FOREIGN KEY ("joinIntentId") REFERENCES "join_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
