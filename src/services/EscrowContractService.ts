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
    const network = process.env.TON_NETWORK || 'testnet';
    const endpoint =
      network === 'mainnet'
        ? process.env.TON_MAINNET_ENDPOINT || 'https://toncenter.com/api/v2'
        : process.env.TON_TESTNET_ENDPOINT ||
          'https://testnet.toncenter.com/api/v2';

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

    // Initialize admin wallet if mnemonic is provided
    const adminMnemonic = process.env.TON_ADMIN_MNEMONIC;
    if (adminMnemonic) {
      this.initializeAdminWallet(adminMnemonic);
    } else {
      console.warn(
        '⚠️ TON_ADMIN_MNEMONIC not configured. Contract write operations will not be available.'
      );
    }
  }

  /**
   * Initialize admin wallet from mnemonic
   */
  private initializeAdminWallet(mnemonic: string) {
    try {
      const key = mnemonicToWalletKey(mnemonic.split(' '));
      const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
      this.adminWallet = wallet;
      this.adminAddress = wallet.address;
      this.adminSecretKey = key.secretKey;
      console.log(`✅ Admin wallet initialized: ${this.adminAddress.toString()}`);
    } catch (error) {
      console.error('❌ Failed to initialize admin wallet:', error);
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

      if (result.exitCode !== 0) {
        console.error(`❌ Getter failed with exit code ${result.exitCode}`);
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
      if (!this.adminSecretKey) {
        throw new Error('Admin secret key not available');
      }
      const seqno = await this.adminWallet.getSeqno();
      const transfer = this.adminWallet.createTransfer({
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

      await this.client.sendExternalMessage(this.adminWallet, transfer);

      // Wait for transaction to be processed
      let currentSeqno = await this.adminWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await this.adminWallet.getSeqno();
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

      const seqno = await this.adminWallet.getSeqno();
      const transfer = this.adminWallet.createTransfer({
        secretKey: (await mnemonicToWalletKey(
          process.env.TON_ADMIN_MNEMONIC!.split(' ')
        )).secretKey,
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

      await this.client.sendExternalMessage(this.adminWallet, transfer);

      // Wait for transaction
      let currentSeqno = await this.adminWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await this.adminWallet.getSeqno();
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

      const seqno = await this.adminWallet.getSeqno();
      const transfer = this.adminWallet.createTransfer({
        secretKey: (await mnemonicToWalletKey(
          process.env.TON_ADMIN_MNEMONIC!.split(' ')
        )).secretKey,
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

      await this.client.sendExternalMessage(this.adminWallet, transfer);

      // Wait for transaction
      let currentSeqno = await this.adminWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await this.adminWallet.getSeqno();
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

      const seqno = await this.adminWallet.getSeqno();
      const transfer = this.adminWallet.createTransfer({
        secretKey: (await mnemonicToWalletKey(
          process.env.TON_ADMIN_MNEMONIC!.split(' ')
        )).secretKey,
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

      await this.client.sendExternalMessage(this.adminWallet, transfer);

      // Wait for transaction
      let currentSeqno = await this.adminWallet.getSeqno();
      let attempts = 0;
      while (currentSeqno === seqno && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentSeqno = await this.adminWallet.getSeqno();
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

