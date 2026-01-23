-- CreateTable
CREATE TABLE "worker_states" (
    "id" TEXT NOT NULL DEFAULT 'blockchain-worker',
    "workerType" TEXT NOT NULL DEFAULT 'blockchain-worker',
    "lastCheckedLt" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_states_workerType_key" ON "worker_states"("workerType");
