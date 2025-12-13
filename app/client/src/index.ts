// index.ts - Complete AMM Backend with Logging
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import ammIdl from "./idl/amm_contract.json";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

// Setup
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const keypair = Keypair.fromSecretKey(bs58.decode(process.env.BACKEND_PRIVATE_KEY!));
const wallet = new anchor.Wallet(keypair);
const provider = new anchor.AnchorProvider(connection, wallet, {});
const program = new anchor.Program(ammIdl as anchor.Idl, provider);

console.log("🚀 AMM Backend Started");
console.log("Wallet:", keypair.publicKey.toBase58());

// Get PDAs
const getPda = (mintA: PublicKey, mintB: PublicKey) => {
  const [amm] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
    PROGRAM_ID
  );
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), mintA.toBuffer(), mintB.toBuffer()],
    PROGRAM_ID
  );
  const [vaultA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_a"), amm.toBuffer()],
    PROGRAM_ID
  );
  const [vaultB] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_b"), amm.toBuffer()],
    PROGRAM_ID
  );
  return { amm, lpMint, vaultA, vaultB };
};

// Fetch transaction logs
async function getLogs(signature: string) {
  console.log("\n📜 Fetching logs...");
  await new Promise(r => setTimeout(r, 3000)); // Wait for confirmation

  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (tx?.meta?.logMessages) {
    console.log("\n=== TRANSACTION LOGS ===");
    tx.meta.logMessages.forEach((log, i) => {
      console.log(`${i + 1}. ${log}`);
    });
    console.log("========================\n");
  }

  return tx?.meta?.logMessages || [];
}

// Initialize Pool
async function initPool(mintA: PublicKey, mintB: PublicKey) {
  console.log("\n🔥 Initializing Pool...");
  console.log("Token A:", mintA.toBase58());
  console.log("Token B:", mintB.toBase58());

  const { amm, lpMint, vaultA, vaultB } = getPda(mintA, mintB);

  console.log("\nDerived PDAs:");
  console.log("  AMM Account:", amm.toBase58());
  console.log("  LP Mint:", lpMint.toBase58());
  console.log("  Vault A:", vaultA.toBase58());
  console.log("  Vault B:", vaultB.toBase58());

  const tx = await (program.methods as any)
    .initialize()
    .accounts({
      signer: wallet.publicKey,
      ammAccount: amm,
      mintA: mintA,
      mintB: mintB,
      lpMint: lpMint,
      vaultA: vaultA,
      vaultB: vaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\n✅ Pool Initialized!");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  await getLogs(tx);

  return { tx, amm: amm.toBase58(), lpMint: lpMint.toBase58() };
}

// Add Liquidity
async function addLiquidity(
  mintA: PublicKey,
  mintB: PublicKey,
  amountA: number,
  amountB: number
) {
  console.log("\n💧 Adding Liquidity...");
  console.log("Amount A:", amountA);
  console.log("Amount B:", amountB);

  const { amm, lpMint, vaultA, vaultB } = getPda(mintA, mintB);

  const userTokenA = await getAssociatedTokenAddress(mintA, wallet.publicKey);
  const userTokenB = await getAssociatedTokenAddress(mintB, wallet.publicKey);
  const userLpToken = await getAssociatedTokenAddress(lpMint, wallet.publicKey);

  const tx = await (program.methods as any)
    .addliquidity(new anchor.BN(amountA), new anchor.BN(amountB))
    .accounts({
      signer: wallet.publicKey,
      ammAccount: amm,
      mintA: mintA,
      mintB: mintB,
      userTokenA,
      userTokenB,
      vaultA,
      vaultB,
      userLpToken,
      lpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("\n✅ Liquidity Added!");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  await getLogs(tx);

  return tx;
}

// Swap
async function swap(
  mintA: PublicKey,
  mintB: PublicKey,
  tokenIn: PublicKey,
  amountIn: number,
  minOut: number
) {
  console.log("\n🔄 Swapping...");
  console.log("Token In:", tokenIn.toBase58());
  console.log("Amount In:", amountIn);
  console.log("Min Out:", minOut);

  const { amm, vaultA, vaultB } = getPda(mintA, mintB);

  const isAIn = tokenIn.equals(mintA);
  const userSource = await getAssociatedTokenAddress(
    isAIn ? mintA : mintB,
    wallet.publicKey
  );
  const userDest = await getAssociatedTokenAddress(
    isAIn ? mintB : mintA,
    wallet.publicKey
  );

  const tx = await (program.methods as any)
    .swap(tokenIn, new anchor.BN(amountIn), new anchor.BN(minOut))
    .accounts({
      signer: wallet.publicKey,
      ammAccount: amm,
      mintA: mintA,
      mintB: mintB,
      vaultA,
      vaultB,
      userSource,
      userDestination: userDest,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("\n✅ Swap Complete!");
  console.log("Transaction:", tx);
  console.log("Explorer:", `https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  await getLogs(tx);

  return tx;
}

// Get Pool Info
async function getPool(mintA: PublicKey, mintB: PublicKey) {
  console.log("\n📊 Getting Pool Info...");

  const { amm } = getPda(mintA, mintB);
  const data = await (program.account as any).ammAccount.fetch(amm);

  console.log("\nPool State:");
  console.log("  Token A:", data.tokenA.toBase58());
  console.log("  Token B:", data.tokenB.toBase58());
  console.log("  Reserve A:", data.reserveA.toString());
  console.log("  Reserve B:", data.reserveB.toString());
  console.log("  Bump:", data.bump);

  return data;
}

// Main execution
async function main() {
  console.log("\n" + "=".repeat(60));

  // Get token mints from env
  const tokenA = new PublicKey(process.env.TOKEN_A_MINT!);
  const tokenB = new PublicKey(process.env.TOKEN_B_MINT!);

  console.log("Using tokens:");
  console.log("  Token A:", tokenA.toBase58());
  console.log("  Token B:", tokenB.toBase58());

  // Step 1: Initialize Pool
  console.log("\n📍 STEP 1: Initialize Pool");
  await initPool(tokenA, tokenB);

  // Step 2: Check Pool
  console.log("\n📍 STEP 2: Check Pool State");
  await getPool(tokenA, tokenB);

  // Step 3: Add Liquidity
  console.log("\n📍 STEP 3: Add Liquidity");
  await addLiquidity(tokenA, tokenB, 100_000_000_000, 100_000_000_000); // 100 tokens each

  // Step 4: Check Pool Again
  console.log("\n📍 STEP 4: Check Pool State After Liquidity");
  await getPool(tokenA, tokenB);

  // Step 5: Swap
  console.log("\n📍 STEP 5: Swap Tokens");
  await swap(tokenA, tokenB, tokenA, 10_000_000_000, 9_000_000_000); // Swap 10 A for ~9.5 B

  // Step 6: Final Pool State
  console.log("\n📍 STEP 6: Final Pool State");
  await getPool(tokenA, tokenB);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 ALL OPERATIONS COMPLETED!");
  console.log("=".repeat(60) + "\n");
}

// Run
if (import.meta.main) {
  main().catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
}

export { initPool, addLiquidity, swap, getPool };