/**
 * Service for interacting with EscrowV1 smart contract on TON blockchain
 * Handles contract operations: createRoom, lock, payout, refund, getRoom
 */
import { Address, toNano, fromNano, Cell, beginCell } from '@ton/core';
import { TonClient, WalletContractV4, internal, SendMode } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import {
  bodyCreateRoom,
  bodyLock,
  bodyPayout,
  bodyRefund,
} from './escrowOps.js';

export interface RoomState {
  status: number; // 0=OPEN, 1=LOCKED, 2=FINISHED, 3=CANCELED
  entryNano: bigint;
  minPlayers: number;
  maxPlayers: number;
  depositedCount: number;
  potNano: bigint;
}

export interface PayoutItem {
  to: Address;
  amountNano: bigint;
}

export class EscrowContractService {
  private client: TonClient;
  private escrowAddress: Address;
  private adminWallet: WalletContractV4 | null = null;
  private adminAddress: Address | null = null;
  private adminSecretKey: Buffer | null = null;

  constructor() {
    // Get network endpoint from environment
    // TonClient uses JSON-RPC and requires /jsonRPC path (POST), not base /api/v2
    const network = process.env.TON_NETWORK || 'testnet';
    const endpoint =
      network === 'mainnet'
        ? process.env.TON_MAINNET_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC'
        : process.env.TON_TESTNET_ENDPOINT ||
          'https://testnet.toncenter.com/api/v2/jsonRPC';

    // Initialize TON client
    this.client = new TonClient({
      endpoint,
      apiKey: process.env.TON_API_KEY || undefined,
    });

    // Get escrow address
    const escrowAddr = process.env.TON_ESCROW_ADDRESS;
    if (!escrowAddr) {
      throw new Error('TON_ESCROW_ADDRESS not configured in environment');
    }
    this.escrowAddress = Address.parse(escrowAddr);

    // Initialize admin wallet if mnemonic is provided (async initialization)
    // Note: This is called in constructor, so we can't use await directly
    // We'll initialize it asynchronously
    const adminMnemonic = process.env.TON_ADMIN_MNEMONIC;
    if (adminMnemonic && adminMnemonic.trim().length > 0) {
      // Initialize asynchronously (fire and forget)
      this.initializeAdminWallet(adminMnemonic).catch((error) => {
        console.error('❌ Failed to initialize admin wallet. Contract write operations will not be available.');
        console.error('Error details:', error);
        // Don't throw - server can continue without admin wallet (read-only mode)
      });
    } else {
      console.warn(
        '⚠️ TON_ADMIN_MNEMONIC not configured. Contract write operations will not be available.'
      );
    }
  }

  /**
   * Initialize admin wallet from mnemonic
   */
  private async initializeAdminWallet(mnemonic: string) {
    try {
      // Validate mnemonic format
      if (!mnemonic || typeof mnemonic !== 'string') {
        throw new Error('Mnemonic must be a non-empty string');
      }

      // Split mnemonic into words
      const trimmed = mnemonic.trim();
      const words = trimmed.split(/\s+/).filter(word => word.length > 0);
      
      // Validate mnemonic length (should be 12 or 24 words)
      if (words.length !== 12 && words.length !== 24) {
        throw new Error(`Invalid mnemonic length: expected 12 or 24 words, got ${words.length}`);
      }

      // Convert mnemonic to wallet key (async)
      let key;
      try {
        key = await mnemonicToWalletKey(words);
      } catch (mnemonicError: any) {
        // Provide more specific error message
        const errorMsg = mnemonicError?.message || 'Unknown error';
        throw new Error(`Failed to convert mnemonic to wallet key: ${errorMsg}. Make sure the mnemonic is valid BIP39 phrase.`);
      }
      
      // Validate key structure
      if (!key) {
        throw new Error('mnemonicToWalletKey returned null or undefined');
      }
      
      if (!key.publicKey) {
        throw new Error('Generated key missing publicKey');
      }
      
      if (!key.secretKey) {
        throw new Error('Generated key missing secretKey');
      }

      // Validate key types (should be Buffers)
      if (!Buffer.isBuffer(key.publicKey)) {
        throw new Error(`publicKey is not a Buffer, got ${typeof key.publicKey}`);
      }
      
      if (!Buffer.isBuffer(key.secretKey)) {
        throw new Error(`secretKey is not a Buffer, got ${typeof key.secretKey}`);
      }

      // Create wallet contract
      const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
      
      this.adminWallet = wallet;
      this.adminAddress = wallet.address;
      this.adminSecretKey = key.secretKey;
      
      console.log(`✅ Admin wallet initialized: ${this.adminAddress.toString()}`);
    } catch (error) {
      console.error('❌ Failed to initialize admin wallet:', error);
      if (error instanceof Error) {
        throw new Error(`Invalid admin mnemonic: ${error.message}`);
      }
      throw new Error('Invalid admin mnemonic');
    }
  }

  /**
   * Get escrow contract address
   */
  getEscrowAddress(): Address {
    return this.escrowAddress;
  }

  /**
   * Get admin wallet address
   */
  getAdminAddress(): Address | null {
    return this.adminAddress;
  }

  /**
   * Check if admin wallet is initialized
   */
  isAdminWalletReady(): boolean {
    return this.adminWallet !== null;
  }

  /**
   * Get room state from contract
   * Uses getter method getRoom(roomId)
   */
  async getRoom(roomId: bigint): Promise<RoomState | null> {
    try {
      // Call getter method using runMethod
      // The getter returns Room? (optional tuple)
      const result = await this.client.runMethod(
        this.escrowAddress,
        'getRoom',
        [{ type: 'int', value: roomId }]
      );

      // In newer versions of @ton/ton, runMethod doesn't return exitCode
      // We check if stack is available instead
      if (!result.stack) {
        console.error(`❌ Getter failed: no stack in result`);
        return null;
      }

      // Parse result stack
      // Expected: (Room?) where Room is a tuple with:
      // - status (int)
      // - entryNano (int)
      // - minPlayers (int)
      // - maxPlayers (int)
      // - depositedCount (int)
      // - potNano (int)
      // - players (dict) - we'll skip this for now
      const stack = result.stack;
      
      // Check if room exists (first element is optional tuple)
      if (stack.remaining === 0) {
        return null; // Room not found
      }

      // Read optional tuple
      const roomTuple = stack.readTupleOpt();
      if (!roomTuple) {
        return null; // Room not found
      }

      // Parse Room tuple
      const status = Number(roomTuple.readBigNumber());
      const entryNano = roomTuple.readBigNumber();
      const minPlayers = Number(roomTuple.readBigNumber());
      const maxPlayers = Number(roomTuple.readBigNumber());
      const depositedCount = Number(roomTuple.readBigNumber());
      const potNano = roomTuple.readBigNumber();
      // Skip players dict for now
      roomTuple.readCellOpt();

      return {
        status,
        entryNano,
        minPlayers,
        maxPlayers,
        depositedCount,
        potNano,
      };
    } catch (error) {
      console.error(`❌ Error getting room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Create a room in the escrow contract
   * Requires admin wallet
   */
  async createRoom(params: {
    roomId: bigint;
    entryNano: bigint;
    minPlayers: number;
    maxPlayers: number;
  }): Promise<string> {
    if (!this.adminWallet) {
      throw new Error('Admin wallet not initialized');
    }

    try {
      const body = bodyCreateRoom({
        roomId: params.roomId,
        entryNano: params.entryNano,
        minPlayers: params.minPlayers,
        maxPlayers: params.maxPlayers,
      });

      // Send transaction
      if (!this.adminSecretKey || !this.adminWallet) {
        throw new Error('Admin wallet not initialized');
      }
      
      // Open wallet with provider
      const openedWallet = this.client.open(this.adminWallet);
      const seqno = await openedWallet.getSeqno();
      
      const transfer = openedWallet.createTransfer({
        secretKey: this.adminSecretKey,
        seqno,
        messages: [
          internal({
            to: this.escrowAddress,
            value: toNano('0.05'), // Gas for contract call
            body,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      });

      await openedWallet.send(transfer);

      // Wait for transaction to be processed
      let currentSeqno = await openedWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await openedWallet.getSeqno();
        attempts++;
      }

      if (currentSeqno === seqno) {
        throw new Error('Transaction timeout');
      }

      console.log(
        `✅ Room ${params.roomId} created in contract (entry: ${fromNano(params.entryNano)} TON, min: ${params.minPlayers}, max: ${params.maxPlayers})`
      );

      // Return transaction hash (we'll use seqno as identifier for now)
      return `create_${params.roomId}_${seqno}`;
    } catch (error) {
      console.error(`❌ Error creating room ${params.roomId}:`, error);
      throw error;
    }
  }

  /**
   * Lock a room in the escrow contract
   * Requires admin wallet
   */
  async lockRoom(roomId: bigint): Promise<string> {
    if (!this.adminWallet) {
      throw new Error('Admin wallet not initialized');
    }

    try {
      const body = bodyLock({ roomId });

      if (!this.adminSecretKey || !this.adminWallet) {
        throw new Error('Admin wallet not initialized');
      }
      
      const openedWallet = this.client.open(this.adminWallet);
      const seqno = await openedWallet.getSeqno();
      const transfer = openedWallet.createTransfer({
        secretKey: this.adminSecretKey,
        seqno,
        messages: [
          internal({
            to: this.escrowAddress,
            value: toNano('0.05'), // Gas for contract call
            body,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      });

      await openedWallet.send(transfer);

      // Wait for transaction
      let currentSeqno = await openedWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await openedWallet.getSeqno();
        attempts++;
      }

      if (currentSeqno === seqno) {
        throw new Error('Transaction timeout');
      }

      console.log(`✅ Room ${roomId} locked in contract`);
      return `lock_${roomId}_${seqno}`;
    } catch (error) {
      console.error(`❌ Error locking room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Send payout to winners
   * Requires admin wallet
   */
  async payout(params: {
    roomId: bigint;
    payouts: PayoutItem[];
  }): Promise<string> {
    if (!this.adminWallet) {
      throw new Error('Admin wallet not initialized');
    }

    if (params.payouts.length === 0) {
      throw new Error('Payouts list cannot be empty');
    }

    if (params.payouts.length > 50) {
      throw new Error('Too many payouts (max 50)');
    }

    try {
      const body = bodyPayout({
        roomId: params.roomId,
        payouts: params.payouts,
      });

      if (!this.adminSecretKey || !this.adminWallet) {
        throw new Error('Admin wallet not initialized');
      }
      
      const openedWallet = this.client.open(this.adminWallet);
      const seqno = await openedWallet.getSeqno();
      const transfer = openedWallet.createTransfer({
        secretKey: this.adminSecretKey,
        seqno,
        messages: [
          internal({
            to: this.escrowAddress,
            value: toNano('0.08'), // Gas for contract call
            body,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      });

      await openedWallet.send(transfer);

      // Wait for transaction
      let currentSeqno = await openedWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await openedWallet.getSeqno();
        attempts++;
      }

      if (currentSeqno === seqno) {
        throw new Error('Transaction timeout');
      }

      const totalAmount = params.payouts.reduce(
        (sum, p) => sum + p.amountNano,
        0n
      );
      console.log(
        `✅ Payout sent for room ${params.roomId} (${params.payouts.length} recipients, total: ${fromNano(totalAmount)} TON)`
      );
      return `payout_${params.roomId}_${seqno}`;
    } catch (error) {
      console.error(`❌ Error sending payout for room ${params.roomId}:`, error);
      throw error;
    }
  }

  /**
   * Send refund to a player
   * Requires admin wallet
   */
  async refund(params: {
    roomId: bigint;
    player: Address;
  }): Promise<string> {
    if (!this.adminWallet) {
      throw new Error('Admin wallet not initialized');
    }

    try {
      const body = bodyRefund({
        roomId: params.roomId,
        player: params.player,
      });

      if (!this.adminSecretKey || !this.adminWallet) {
        throw new Error('Admin wallet not initialized');
      }
      
      const openedWallet = this.client.open(this.adminWallet);
      const seqno = await openedWallet.getSeqno();
      const transfer = openedWallet.createTransfer({
        secretKey: this.adminSecretKey,
        seqno,
        messages: [
          internal({
            to: this.escrowAddress,
            value: toNano('0.05'), // Gas for contract call
            body,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      });

      await openedWallet.send(transfer);

      // Wait for transaction
      let currentSeqno = await openedWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await openedWallet.getSeqno();
        attempts++;
      }

      if (currentSeqno === seqno) {
        throw new Error('Transaction timeout');
      }

      console.log(
        `✅ Refund sent for room ${params.roomId} to ${params.player.toString()}`
      );
      return `refund_${params.roomId}_${seqno}`;
    } catch (error) {
      console.error(
        `❌ Error sending refund for room ${params.roomId}:`,
        error
      );
      throw error;
    }
  }
}

// Singleton instance
export const escrowContractService = new EscrowContractService();

