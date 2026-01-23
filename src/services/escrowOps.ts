/**
 * Operations for EscrowV1 contract
 * Based on _ops.ts from contracts repository
 */
import { beginCell } from '@ton/core';

export const OP_CREATE_ROOM = 0x43524541; // 'CREA'
export const OP_DEPOSIT = 0x4445504f; // 'DEPO'
export const OP_REFUND = 0x52454655; // 'REFU'
export const OP_LOCK = 0x4c4f434b; // 'LOCK'
export const OP_PAYOUT = 0x5041594f; // 'PAYO'

export function bodyCreateRoom(params: {
  roomId: bigint;
  entryNano: bigint;
  minPlayers: number;
  maxPlayers: number;
  queryId?: bigint;
}) {
  const qid = params.queryId ?? 0n;
  return beginCell()
    .storeUint(OP_CREATE_ROOM, 32)
    .storeUint(qid, 64)
    .storeUint(params.roomId, 64)
    .storeUint(params.entryNano, 64)
    .storeUint(params.minPlayers, 16)
    .storeUint(params.maxPlayers, 16)
    .endCell();
}

export function bodyDeposit(params: {
  roomId: bigint;
  nonce: bigint;
  queryId?: bigint;
}) {
  const qid = params.queryId ?? 0n;
  return beginCell()
    .storeUint(OP_DEPOSIT, 32)
    .storeUint(qid, 64)
    .storeUint(params.roomId, 64)
    .storeUint(params.nonce, 64)
    .endCell();
}

export function bodyLock(params: { roomId: bigint; queryId?: bigint }) {
  const qid = params.queryId ?? 0n;
  return beginCell()
    .storeUint(OP_LOCK, 32)
    .storeUint(qid, 64)
    .storeUint(params.roomId, 64)
    .endCell();
}

export function bodyPayout(params: {
  roomId: bigint;
  payouts: Array<{ to: import('@ton/core').Address; amountNano: bigint }>;
  queryId?: bigint;
}) {
  const qid = params.queryId ?? 0n;

  let c = beginCell()
    .storeUint(OP_PAYOUT, 32)
    .storeUint(qid, 64)
    .storeUint(params.roomId, 64)
    .storeUint(params.payouts.length, 16);

  for (const p of params.payouts) {
    c = c.storeAddress(p.to).storeUint(p.amountNano, 64);
  }

  return c.endCell();
}

export function bodyRefund(params: {
  roomId: bigint;
  player: import('@ton/core').Address;
  queryId?: bigint;
}) {
  const qid = params.queryId ?? 0n;
  return beginCell()
    .storeUint(OP_REFUND, 32)
    .storeUint(qid, 64)
    .storeUint(params.roomId, 64)
    .storeAddress(params.player)
    .endCell();
}

