import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import ammIdl from "./idl/amm_contract.json";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress,getOrCreateAssociatedTokenAccount  } from "@solana/spl-token";

// Environment checks

const programId = process.env.PROGRAM_ID;
if (!programId) throw new Error("PROGRAM_ID missing");

const solanaRpc = process.env.SOLANA_RPC_URL;
if (!solanaRpc) throw new Error("SOLANA_RPC_URL missing");

const PROGRAM_ID = new PublicKey(programId);
const connection = new Connection(solanaRpc, "confirmed");

// Load wallet
let backendKeypair: Keypair;
const loadBackendKeypair = () => {
  if (backendKeypair) return backendKeypair;

  const base58Key = process.env.BACKEND_PRIVATE_KEY;
  if (!base58Key) throw new Error("BACKEND_PRIVATE_KEY missing");

  backendKeypair = Keypair.fromSecretKey(bs58.decode(base58Key));
  console.log("Wallet:", backendKeypair.publicKey.toBase58());
  return backendKeypair;
};

const wallet = new anchor.Wallet(loadBackendKeypair());
const provider = new anchor.AnchorProvider(connection, wallet, {});
const program = new anchor.Program(ammIdl as anchor.Idl, provider);

// Get PDAs - FIXED: Return individual values
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

// Initialize Pool - FIXED
const initPool = async (mintA: PublicKey, mintB: PublicKey) => {
  const { amm, lpMint, vaultA, vaultB } = getPda(mintA, mintB);

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

  console.log("✅ Init Pool Initialized:", tx);
  return tx;
};

// Add Liquidity - FIXED
const addLiquidity = async (
  mintA: PublicKey,
  mintB: PublicKey,
  amountA: number,
  amountB: number
) => {
  const { amm, lpMint, vaultA, vaultB } = getPda(mintA, mintB);

  const userTokenA = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintA,
      wallet.publicKey
    )
  ).address;
  
  const userTokenB = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintB,
      wallet.publicKey
    )
  ).address;
  
  const userLpToken = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      lpMint,
      wallet.publicKey
    )
  ).address;
  
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

  console.log("✅ Liquidity Added:", tx);
  return tx;
};

// Swap - FIXED
const swap = async (
  mintA: PublicKey,
  mintB: PublicKey,
  tokenIn: PublicKey,
  amountIn: number,
  minOut: number
) => {
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

  console.log("✅ Swapped:", tx);
  return tx;
};

// Get Pool Info - FIXED
const getPool = async (mintA: PublicKey, mintB: PublicKey) => {
  const { amm } = getPda(mintA, mintB);
  const data = await (program.account as any).ammAccount.fetch(amm);
  console.log("📊 Pool:", data);
  return data;
};

// Main
async function main() {

    const TA = process.env.TOKEN_A_MINT;
    if(!TA){
        throw new Error("Token a mint missing");
    }

    
    const TB = process.env.TOKEN_B_MINT;
    if(!TB){
        throw new Error("Token B mint missing");
    }
  const tokenA = new PublicKey(TA);
  const tokenB = new PublicKey(TB);

  // Initialize pool
  // await initPool(tokenA, tokenB);

//   // Get pool info
  // await getPool(tokenA, tokenB);

// //   Add liquidity
  // await addLiquidity(tokenA, tokenB, 500000, 500000);

// //   Swap
  await swap(tokenA, tokenB, tokenA, 4000, 3000);
}

// Export functions
export { initPool, addLiquidity, swap, getPool };

// Run if main module
if (import.meta.main) {
  main().catch(console.error);
}