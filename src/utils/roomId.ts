/**
 * Utility for converting matchId (string) to roomId (uint64 BigInt)
 * for on-chain escrow contract interactions
 */

const MASK_16 = 0xffffn;

/**
 * Hash string to 16-bit value using FNV-1a algorithm
 * @param str Input string
 * @returns 16-bit hash (0-65535)
 */
function hash16(str: string): bigint {
  // FNV-1a 32-bit -> берем младшие 16 бит
  let h = 0x811c9dc5n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x01000193n) & 0xffffffffn;
  }
  return h & MASK_16;
}

/**
 * Convert matchId string to roomId (uint64 BigInt)
 * Format: match_<timestamp_ms>_<suffix>
 * Example: match_1768688464413_60rnyirpq
 * 
 * roomId = (timestamp_ms << 16) | hash16(suffix)
 * 
 * @param matchId Match ID string (e.g., "match_1768688464413_60rnyirpq")
 * @returns roomId as BigInt (uint64)
 * @throws Error if matchId format is invalid
 */
export function matchIdToRoomId(matchId: string): bigint {
  // match_<ts>_<suffix>
  const m = /^match_(\d+)_(.+)$/.exec(matchId);
  if (!m) {
    // запасной путь: просто hash16/32 от всей строки + текущий ts не использовать
    // но лучше падать, чтобы не получить непредсказуемые ids
    throw new Error(`Unexpected matchId format: ${matchId}`);
  }

  const tsMs = BigInt(m[1]);     // 1768688464413
  const suffix = m[2];           // 60rnyirpq

  // (tsMs << 16) | hash16
  return (tsMs << 16n) | hash16(suffix);
}

/**
 * Convert roomId (BigInt) to decimal string for storage/logging
 * @param roomId Room ID as BigInt
 * @returns Room ID as decimal string
 */
export function roomIdToString(roomId: bigint): string {
  // храним/логируем как десятичную строку, чтобы не терять точность
  return roomId.toString(10);
}

/**
 * Parse roomId from string (if stored as string)
 * @param roomIdStr Room ID as string (decimal)
 * @returns Room ID as BigInt
 */
export function roomIdFromString(roomIdStr: string): bigint {
  return BigInt(roomIdStr);
}

