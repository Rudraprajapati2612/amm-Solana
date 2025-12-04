import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AmmContract } from "../target/types/amm_contract";
import {TOKEN_PROGRAM_ID, createAccount, createMint, mintTo } from "@solana/spl-token";
import {Keypair,PublicKey,LAMPORTS_PER_SOL} from "@solana/web3.js"; 
import { assert } from "chai";
describe("amm-contract", () => {
  // Configure the client to use the local cluster.
  // anchor.setProvider(anchor.AnchorProvider.env());

  
  
  
  describe("Amm Contract",()=>{
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.ammContract as Program<AmmContract>;

    const payer = provider.wallet as anchor.Wallet;
    const user = Keypair.generate();

    let mintA : PublicKey;
    let mintB : PublicKey;

    let userTokenAccountA : PublicKey;
    let userTokenAccountB: PublicKey;
    let userLpTokenAccount : PublicKey;
    
    let ammAccount: PublicKey;
    let vaultA : PublicKey;
    let vaultB : PublicKey;
    let lpMint : PublicKey;
    let ammBump : Number;

    const INITIAL_MINT_AMOUNT = 1000 * LAMPORTS_PER_SOL;

    before(async () =>{
      const airdropSign = await provider.connection.requestAirdrop(
         user.publicKey,
        2*LAMPORTS_PER_SOL
      );
      // creating token a 
      mintA = await createMint(
        provider.connection,
        payer.payer,
        payer.publicKey,
        null,
        9,
      );

      mintB = await createMint(
        provider.connection,
        payer.payer,
        // this anchor contract has permission to mint the token 
        payer.publicKey,
        null ,
        9
      )

      // create user token account 
      userTokenAccountA=await createAccount(
        provider.connection,
        payer.payer,
        mintA,
        user.publicKey
      )

      userTokenAccountB = await createAccount(
        provider.connection,
        payer.payer,
        mintB,
        user.publicKey
      )

      await mintTo(
        provider.connection,
        payer.payer,
        mintA,
        userTokenAccountA,
        payer.publicKey,
        INITIAL_MINT_AMOUNT
      );

      await mintTo(
        provider.connection,
        payer.payer,
        mintB,
        userTokenAccountB,
        payer.publicKey,
        INITIAL_MINT_AMOUNT
      );

          // Derive PDAs
    [ammAccount, ammBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );

    [vaultA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_a"), ammAccount.toBuffer()],
      program.programId
    );

    [vaultB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_b"), ammAccount.toBuffer()],
      program.programId
    );

    [lpMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );

    console.log("Setup complete!");
    console.log("Mint A:", mintA.toBase58());
    console.log("Mint B:", mintB.toBase58());
    console.log("User:", user.publicKey.toBase58());
    });
    
    it("Is initialized AMM pool", async () => {
    
      const tx = await program.methods.initialize()
      .accounts({
        signer:payer.publicKey,
        mintA:mintA,
        mintB:mintB,
        tokenProgram:TOKEN_PROGRAM_ID,
      })
      .rpc();

      let ammAccountdata = await program.account.ammAccount.fetch(ammAccount);

      
      assert.equal(ammAccountdata.tokenA.toBase58(), mintA.toBase58());
      assert.equal(ammAccountdata.tokenB.toBase58(), mintB.toBase58());
      assert.equal(ammAccountdata.reserveA.toNumber(), 0);
      assert.equal(ammAccountdata.reserveB.toNumber(), 0);
      assert.equal(ammAccountdata.bump, ammBump);   
      
      console.log("Your transaction signature", tx);
    });
  })

  
});
