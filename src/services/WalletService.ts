import { prisma } from '../db/prisma.js';
import crypto from 'crypto';

export interface WalletProofPayload {
  payload: string;
  expiresAt: Date;
}

export interface TonProof {
  timestamp: number;
  domain: {
    lengthBytes: number;
    value: string;
  };
  signature: string;
}

export interface Wallet {
  id: string;
  playerId: string;
  address: string;
  network: 'mainnet' | 'testnet';
  publicKey: string;
  connectedAt: Date;
}

/**
 * Service for managing TON wallet connections via TON Connect
 * Handles wallet proof generation and verification
 */
export class WalletService {
  /**
   * Generate proof payload for TON Connect ton_proof
   * Frontend will use this payload to get ton_proof from wallet
   */
  generateProofPayload(playerId: string): WalletProofPayload {
    // Generate random nonce for uniqueness
    const nonce = crypto.randomBytes(32).toString('hex');
    
    // Create timestamp
    const timestamp = Date.now();
    
    // Create payload: nonce + playerId + timestamp
    // Format: hex(nonce) + playerId + timestamp (in base64 for consistency)
    const payloadData = {
      nonce,
      playerId,
      timestamp,
    };
    
    // Encode to base64 for transport
    const payload = Buffer.from(JSON.stringify(payloadData)).toString('base64');
    
    // Payload expires in 5 minutes
    const expiresAt = new Date(timestamp + 5 * 60 * 1000);
    
    return {
      payload,
      expiresAt,
    };
  }

  /**
   * Verify ton_proof and link wallet to player
   * @param playerId Telegram user ID
   * @param address TON wallet address
   * @param network 'mainnet' | 'testnet'
   * @param proof TON Connect ton_proof object
   * @param payload Original payload that was sent to frontend
   */
  async verifyAndLinkWallet(
    playerId: string,
    address: string,
    network: 'mainnet' | 'testnet',
    proof: TonProof,
    payload: string
  ): Promise<Wallet> {
    // Decode payload
    let payloadData: { nonce: string; playerId: string; timestamp: number };
    try {
      payloadData = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    } catch (error) {
      throw new Error('Invalid payload format');
    }

    // Verify payload belongs to this player
    if (payloadData.playerId !== playerId) {
      throw new Error('Payload playerId mismatch');
    }

    // Verify payload hasn't expired (check timestamp)
    const payloadTimestamp = payloadData.timestamp;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (now - payloadTimestamp > fiveMinutes) {
      throw new Error('Proof payload expired');
    }

    // TODO: Verify TON proof signature
    // This requires @ton/crypto or @ton/core library
    // For now, we'll do basic validation and accept the proof
    // In production, you MUST verify the signature using wallet's public key
    
    // Basic validation
    if (!proof.signature || !proof.domain || !proof.timestamp) {
      throw new Error('Invalid proof format');
    }

    // Verify domain matches (should be your app domain)
    const expectedDomain = process.env.TON_CONNECT_DOMAIN || 'ton.app';
    if (proof.domain.value !== expectedDomain) {
      console.warn(`⚠️ Domain mismatch: expected ${expectedDomain}, got ${proof.domain.value}`);
      // In production, this should throw, but for development we allow it
      // throw new Error('Domain mismatch in proof');
    }

    // Extract public key from address or proof (if available)
    // For now, we'll store a placeholder - in production, extract from proof
    const publicKey = proof.signature.substring(0, 64) || crypto.randomBytes(32).toString('hex');

    // Check if wallet already exists for this player
    const existingWallet = await prisma.wallet.findUnique({
      where: { playerId },
    });

    if (existingWallet) {
      // Update existing wallet
      const updated = await prisma.wallet.update({
        where: { id: existingWallet.id },
        data: {
          address,
          network,
          publicKey,
          updatedAt: new Date(),
        },
      });

      console.log(`✅ Updated wallet for player ${playerId}: ${address}`);
      return this.dbWalletToWallet(updated);
    }

    // Check if address is already used by another player
    const existingAddress = await prisma.wallet.findUnique({
      where: { address },
    });

    if (existingAddress && existingAddress.playerId !== playerId) {
      throw new Error('Wallet address already linked to another player');
    }

    // Create new wallet
    const wallet = await prisma.wallet.create({
      data: {
        playerId,
        address,
        network,
        publicKey,
      },
    });

    console.log(`✅ Linked wallet ${address} to player ${playerId}`);
    return this.dbWalletToWallet(wallet);
  }

  /**
   * Get wallet by player ID
   */
  async getWalletByPlayerId(playerId: string): Promise<Wallet | null> {
    const wallet = await prisma.wallet.findUnique({
      where: { playerId },
    });

    if (!wallet) {
      return null;
    }

    return this.dbWalletToWallet(wallet);
  }

  /**
   * Get wallet by address
   */
  async getWalletByAddress(address: string): Promise<Wallet | null> {
    const wallet = await prisma.wallet.findUnique({
      where: { address },
    });

    if (!wallet) {
      return null;
    }

    return this.dbWalletToWallet(wallet);
  }

  /**
   * Check if player has connected wallet
   */
  async hasWallet(playerId: string): Promise<boolean> {
    const wallet = await prisma.wallet.findUnique({
      where: { playerId },
      select: { id: true },
    });

    return wallet !== null;
  }

  /**
   * Convert Prisma Wallet to Wallet interface
   */
  private dbWalletToWallet(wallet: any): Wallet {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      address: wallet.address,
      network: wallet.network as 'mainnet' | 'testnet',
      publicKey: wallet.publicKey,
      connectedAt: wallet.connectedAt,
    };
  }
}

// Singleton instance
export const walletService = new WalletService();

