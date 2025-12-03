use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("ApjKE4vSFoMgd9Xd3J2vDGphVTCJgtD7sELUvSvwS7yY");

#[program]
pub mod amm_contract {



    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);

        let amm = &mut ctx.accounts.amm_account;
        amm.token_a = ctx.accounts.mint_a.key();
        amm.token_b = ctx.accounts.mint_b.key();
        amm.reserve_a=0;
        amm.reserve_b=0;
        amm.bump = ctx.bumps.amm_account;
        

        Ok(())
    }

    pub fn addliquidity(ctx:Context<AddLiquidityPool>,amount1 : u64,amount2:u64)->Result<()>{
        let amm = &mut ctx.accounts.amm_account;
        require!(amount1> 0&& amount2>0,AmmError::InvalidAmount);

       
        let lp_mint = &ctx.accounts.lp_mint;
        let token_program = &ctx.accounts.token_program;

        let token_a_key = amm.token_a;
        let token_b_key = amm.token_b;
        let bump = amm.bump;

        let seeds: [&[u8]; 4] = [
            b"pool",
            token_a_key.as_ref(),
            token_b_key.as_ref(),
            &[bump],
        ];
        let signer_seeds: [&[&[u8]]; 1] = [&seeds];

        let liquidity_minted: u64;
        // adding liquidity for the first time 
        if amm.reserve_a==0 && amm.reserve_b==0 {

            
           
            let product = (amount1 as u128).checked_mul(amount2 as u128).ok_or(AmmError::Overflow)?;
            liquidity_minted = product.integer_sqrt() as u64;
            amm.reserve_a= amm.reserve_a.checked_add(amount1).ok_or(AmmError::Overflow)?;
            amm.reserve_b= amm.reserve_b.checked_add(amount2).ok_or(AmmError::Overflow)?;
        }

        else {
            let optimal_b = amm
            .reserve_b
            .checked_mul(amount1)
            .ok_or(AmmError::Overflow)?
            .checked_div(amm.reserve_a)
            .ok_or(AmmError::Overflow)?;

        require!(amount2 == optimal_b, AmmError::InvalidRatio);

        // LP tokens minted proportionally
        let lp_supply = lp_mint.supply;
        liquidity_minted = (lp_supply as u128)
            .checked_mul(amount1 as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(amm.reserve_a as u128)
            .ok_or(AmmError::Overflow)? as u64;

        // update reserves
        amm.reserve_a = amm.reserve_a.checked_add(amount1).ok_or(AmmError::Overflow)?;
        amm.reserve_b = amm.reserve_b.checked_add(amount2).ok_or(AmmError::Overflow)?;
        }
       
        // token transfer from user to LP(PDA)  

        let transfer_a_contex = anchor_spl::token::Transfer{
            from : ctx.accounts.user_token_a.to_account_info(),
            to: ctx.accounts.vault_a.to_account_info(),
            authority: ctx.accounts.signer.to_account_info()
        };

        let cpi_a_ctx = CpiContext::new(token_program.to_account_info(), transfer_a_contex);
        anchor_spl::token::transfer(cpi_a_ctx, amount1)?;

        // token b transfer from user to LP(PDA)
        let transfer_b_contex = anchor_spl::token::Transfer{
            from : ctx.accounts.user_token_b.to_account_info(),
            to: ctx.accounts.vault_b.to_account_info(),
            authority: ctx.accounts.signer.to_account_info()
        };

        let cpi_b_ctx = CpiContext::new(token_program.to_account_info(), transfer_b_contex);
        anchor_spl::token::transfer(cpi_b_ctx, amount2)?;


        // and based on this Lp will give a LP toke to the user 

        let mint_contex = anchor_spl::token::MintTo{
            mint : ctx.accounts.lp_mint.to_account_info(),
            to : ctx.accounts.user_lp_token.to_account_info(),
            authority : amm.to_account_info()
        };

        let mint_cpi = CpiContext::new_with_signer(token_program.to_account_info(), mint_contex, &signer_seeds);
        anchor_spl::token::mint_to(mint_cpi, liquidity_minted)?;
        Ok(())

    }
    pub fn swap (ctx:Context<Swap>,token_inp:Pubkey,amount_token_inp:u64)->Result<()>{
        require!(amount_token_inp > 0, AmmError::InvalidAmount);
         
        let amm = &mut ctx.accounts.amm_account;
         let vault_a = &ctx.accounts.vault_a;
         let vault_b = &ctx.accounts.vault_b;
         let minta = ctx.accounts.mint_a.key();
         let mintb = ctx.accounts.mint_b.key();
         let user_source = &ctx.accounts.user_source;
         let user_destination = &ctx.accounts.user_destination;
         let tokenprogram = &ctx.accounts.token_program;


         require!(user_source.mint == minta || user_source.mint == mintb , AmmError::InvalidToken);
         let seeds = &[
            b"pool",
            minta.as_ref(),
            mintb.as_ref(),
            &[amm.bump],
        ];
        let signer_seeds = &[&seeds[..]];

         let (reserve_in,reserve_out,vault_in,vault_out) = if token_inp == minta {
            (amm.reserve_a,amm.reserve_b,vault_a,vault_b)
         }else{
            (amm.reserve_b,amm.reserve_a,vault_b,vault_a)
         };
         
        //  transfer token from user to PDA 
        let token_contex_transfer = anchor_spl::token::Transfer{
            from : ctx.accounts.user_source.to_account_info(),
            to  : vault_in.to_account_info(),
            authority : ctx.accounts.signer.to_account_info()
        };

        let cpi_ctx = CpiContext::new(tokenprogram.to_account_info(), token_contex_transfer);

        anchor_spl::token::transfer(cpi_ctx,amount_token_inp)?;


        let amount_out = reserve_out
        .checked_mul(amount_token_inp)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(reserve_in + amount_token_inp)
        .ok_or(AmmError::MathOverflow)?;

        // transfer from  Liquidity pool to user in this pda need to do a signature


        let pda_token_transfer = anchor_spl::token::Transfer{
            from : vault_out.to_account_info(),
            to : user_destination.to_account_info(),
            authority : amm.to_account_info()
        } ;
        let pda_cpi = CpiContext::new_with_signer(tokenprogram.to_account_info(), pda_token_transfer, signer_seeds);
        anchor_spl::token::transfer(pda_cpi, amount_out)?;

        if token_inp==minta{
            amm.reserve_a+= amount_token_inp;
            amm.reserve_b -= amount_out
        }else{
            amm.reserve_a -= amount_out;
            amm.reserve_b+=amount_token_inp
        }
        Ok(())
    }
    pub fn removeliquidity(ctx:Context<RemoveLiquidityPool>,lp_amount : u64)->Result<()>{
        require!(lp_amount>0,AmmError::InvalidAmount);

        let amm = &mut ctx.accounts.amm_account;
        let lp_mint  =  &ctx.accounts.lp_mint;
        let lp_supply  = lp_mint.supply;

        let amount_a = (amm.reserve_a as u128)
            .checked_mul(lp_amount as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(lp_supply as u128)
            .ok_or(AmmError::Overflow)? as u64;

        let amount_b = (amm.reserve_b as u128)
            .checked_mul(lp_amount as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(lp_supply as u128)
            .ok_or(AmmError::Overflow)? as u64;
        
        let token_a_key = amm.token_a;
        let token_b_key = amm.token_b;
        let bump = amm.bump;
        let seeds : [&[u8];4] =  [
            b"pool",
            token_a_key.as_ref(),
            token_b_key.as_ref(),
            &[bump]
        ];
        
        let signer_seeds : [&[&[u8]]; 1] = [&seeds];

        // Burn LP token 

        let burn_ctx = anchor_spl::token::Burn{
            mint :  lp_mint.to_account_info(),
            from : ctx.accounts.user_lp_token.to_account_info(),
            authority:ctx.accounts.signer.to_account_info()
        };

        let burn_cpi = CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_ctx);
        anchor_spl::token::burn(burn_cpi, lp_amount)?;
        
        // transfer token A  From Liqyidity pool to user

        let transfer_a_ctx  = anchor_spl::token::Transfer{
            from : ctx.accounts.vault_a.to_account_info(),
            to : ctx.accounts.user_token_a.to_account_info(),
            authority : amm.to_account_info()
        };

        let a_cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_a_ctx, &signer_seeds);
        anchor_spl::token::transfer(a_cpi_ctx, amount_a)?;

        // transfer token B from Liquidity pool to user 

        let transfer_b_ctx  = anchor_spl::token::Transfer{
            from : ctx.accounts.vault_b.to_account_info(),
            to : ctx.accounts.user_token_b.to_account_info(),
            authority : amm.to_account_info()
        };

        let b_cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_b_ctx, &signer_seeds);
        anchor_spl::token::transfer(b_cpi_ctx, amount_b)?;

        amm.reserve_a = amm.reserve_a.checked_sub(amount_a).ok_or(AmmError::Overflow)?;
        amm.reserve_b = amm.reserve_b.checked_sub(amount_b).ok_or(AmmError::Overflow)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + AmmAccount::INIT_SPACE,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump
    )]
    pub amm_account: Account<'info, AmmAccount>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddLiquidityPool<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump = amm_account.bump
    )]
    pub amm_account: Account<'info, AmmAccount>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    // user pays from these token accounts
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,

    // PDA-owned vaults (pool reserves)
    #[account(
        mut,
        seeds = [b"vault_a", amm_account.key().as_ref()],
        bump,
        token::mint = mint_a,
        token::authority = amm_account
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", amm_account.key().as_ref()],
        bump,
        token::mint = mint_b,
        token::authority = amm_account
    )]
    pub vault_b: Account<'info, TokenAccount>,

    // LP tokens go here for user
    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,

    // LP mint (pool share token)
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RemoveLiquidityPool<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump = amm_account.bump
    )]
    pub amm_account: Account<'info, AmmAccount>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    // same PDA-owned vaults as AddLiquidity
    #[account(
        mut,
        seeds = [b"vault_a", amm_account.key().as_ref()],
        bump,
        token::mint = mint_a,
        token::authority = amm_account
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", amm_account.key().as_ref()],
        bump,
        token::mint = mint_b,
        token::authority = amm_account
    )]
    pub vault_b: Account<'info, TokenAccount>,

    // LP mint to burn from
    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    // user receives tokens back here
    #[account(mut)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_b: Account<'info, TokenAccount>,

    // user LP account to burn from
    #[account(mut)]
    pub user_lp_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump = amm_account.bump
    )]
    pub amm_account: Account<'info, AmmAccount>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    // vaults (same PDAs)
    #[account(
        mut,
        seeds = [b"vault_a", amm_account.key().as_ref()],
        bump,
        token::mint = mint_a,
        token::authority = amm_account
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", amm_account.key().as_ref()],
        bump,
        token::mint = mint_b,
        token::authority = amm_account
    )]
    pub vault_b: Account<'info, TokenAccount>,

    // user source token account (input)
    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,

    // user destination token account (output)
    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct AmmAccount {
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub bump: u8,
}

#[error_code]
pub enum AmmError {
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("value is overflowed")]
    Overflow,
    #[msg("Ratio is not valid")]
    InvalidRatio,
    #[msg("Invalid token")]
    InvalidToken,
    #[msg("overflow errro change in lots of bits")]
    MathOverflow
}

trait IntegerSquareRoot {
    fn integer_sqrt(&self) -> Self;
}

impl IntegerSquareRoot for u128 {
    fn integer_sqrt(&self) -> Self {
        let mut z = (*self + 1) / 2;
        let mut y = *self;
        while z < y {
            y = z;
            z = (*self / z + z) / 2;
        }
        y
    }
}