// Setup file for Vitest
// This runs before all tests, ensuring env variables are set

process.env.TON_ESCROW_ADDRESS = process.env.TON_ESCROW_ADDRESS || '0:test_escrow_address_for_testing';

