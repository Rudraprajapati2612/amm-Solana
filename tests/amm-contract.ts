import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AmmContract } from "../target/types/amm_contract";
import {TOKEN_PROGRAM_ID, TokenAccountNotFoundError, createAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import {Keypair,PublicKey,LAMPORTS_PER_SOL} from "@solana/web3.js"; 
import { assert } from "chai";
import { min } from "bn.js";
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

    it("Add liquidity for the first time", async()=>{
      const amountA = new anchor.BN(100 * LAMPORTS_PER_SOL);
      const amountB = new anchor.BN(100 * LAMPORTS_PER_SOL);

      userLpTokenAccount = await createAccount(
        provider.connection,
        payer.payer,
        lpMint,
        user.publicKey
      );

      const tx = await program.methods.addliquidity(amountA,amountB).
      accounts({
        signer : user.publicKey,
        mintA : mintA,
        mintB:mintB,
        userTokenA:userTokenAccountA,
        userTokenB:userTokenAccountB,
        userLpToken : userLpTokenAccount,
        tokenProgram:TOKEN_PROGRAM_ID
      }).
      signers([user]).
      rpc();

      console.log("Add liquidity transaction signature:", tx);
      // now check that actuclly token is transfered from  user to Account 
      const ammAccounData = await program.account.ammAccount.fetch(ammAccount);
      assert(ammAccounData.reserveA.toString(),amountA.toString());
      assert(ammAccounData.reserveB.toString(),amountB.toString());

      //  check the account info and cheack that amount of lp is greatet than 0
      const lpTokenAccount = await getAccount(
        provider.connection,
        userLpTokenAccount
      );
      assert.ok(Number(lpTokenAccount.amount) > 0);
      console.log("Liquidity added successfully!");
      console.log("LP Tokens minted:", lpTokenAccount.amount.toString());
    });

    it("swap Token A for  Token B ",async()=>{
      const swapAmount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    const minAmountOut = new anchor.BN(1);
    const userAccountABefore = await getAccount(
      provider.connection,
      userTokenAccountA
    );

    const userAccountBBefore = await getAccount(
      provider.connection,
      userTokenAccountB
    );


    const tx = await program.methods.swap(mintA,swapAmount,minAmountOut)
    .accounts({
      signer : user.publicKey,
      mintA : mintA,
      mintB:mintB,
      userSource:userTokenAccountA,
      userDestination:userTokenAccountB,
      tokenProgram : TOKEN_PROGRAM_ID
    }).signers([user]).rpc()

    console.log("Swap transaction signature:", tx);

    // Get balances after swap
    const userAccountAAfter = await getAccount(
      provider.connection,
      userTokenAccountA
    );
    const userAccountBAfter = await getAccount(
      provider.connection,
      userTokenAccountB
    );

    // Verify token A decreased
    assert.ok(userAccountAAfter.amount < userAccountABefore.amount);
    // Verify token B increased
    assert.ok(userAccountBAfter.amount > userAccountBBefore.amount);

    console.log("Swap successful!");
    console.log(
      "Token A spent:",
      (userAccountABefore.amount - userAccountAAfter.amount).toString()
    );
    console.log(
      "Token B received:",
      (userAccountBAfter.amount - userAccountBBefore.amount).toString()
    );

    })
//  check balance before swap then call swap function and after it check balance after swap 
// if balance of b is decrease and a increase then test passed 
    it("swap token B for  token A",async()=>{
      const swapAmount = new anchor.BN(5 * LAMPORTS_PER_SOL);
    const minAmountOut = new anchor.BN(1);

    // Get balances before swap
    const userAccountABefore = await getAccount(
      provider.connection,
      userTokenAccountA
    );
    const userAccountBBefore = await getAccount(
      provider.connection,
      userTokenAccountB
    );

    const tx = await program.methods
      .swap(mintB, swapAmount, minAmountOut)
      .accounts({
        signer: user.publicKey,
    
        mintA: mintA,
        mintB: mintB,
        userSource: userTokenAccountB,
        userDestination: userTokenAccountA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    console.log("Swap transaction signature:", tx);

    // Get balances after swap
    const userAccountAAfter = await getAccount(
      provider.connection,
      userTokenAccountA
    );
    const userAccountBAfter = await getAccount(
      provider.connection,
      userTokenAccountB
    );

    // Verify token B decreased
    assert.ok(userAccountBAfter.amount < userAccountBBefore.amount);
    // Verify token A increased
    assert.ok(userAccountAAfter.amount > userAccountABefore.amount);

    console.log("Reverse swap successful!");
    })
    
    it("Removes liquidity from the pool", async () => {
      // Get LP token balance
      const lpTokenAccount = await getAccount(
        provider.connection,
        userLpTokenAccount
      );
      const lpAmount = new anchor.BN(lpTokenAccount.amount.toString()).div(
        new anchor.BN(2)
      ); // Remove 50% of liquidity
  
      // Get balances before
      const userAccountABefore = await getAccount(
        provider.connection,
        userTokenAccountA
      );
      const userAccountBBefore = await getAccount(
        provider.connection,
        userTokenAccountB
      );
  
      const tx = await program.methods
        .removeliquidity(lpAmount)
        .accounts({
          signer: user.publicKey,
          
          mintA: mintA,
          mintB: mintB,
          
          userTokenA: userTokenAccountA,
          userTokenB: userTokenAccountB,
          userLpToken: userLpTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
  
      console.log("Remove liquidity transaction signature:", tx);
  
      // Get balances after
      const userAccountAAfter = await getAccount(
        provider.connection,
        userTokenAccountA
      );
      const userAccountBAfter = await getAccount(
        provider.connection,
        userTokenAccountB
      );
  
      // Verify tokens were returned
      assert.ok(userAccountAAfter.amount > userAccountABefore.amount);
      assert.ok(userAccountBAfter.amount > userAccountBBefore.amount);
  
      console.log("Liquidity removed successfully!");
      console.log(
        "Token A received:",
        (userAccountAAfter.amount - userAccountABefore.amount).toString()
      );
      console.log(
        "Token B received:",
        (userAccountBAfter.amount - userAccountBBefore.amount).toString()
      );
    });

  })

});
