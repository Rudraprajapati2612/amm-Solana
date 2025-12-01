use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("ApjKE4vSFoMgd9Xd3J2vDGphVTCJgtD7sELUvSvwS7yY");

#[program]
pub mod amm_contract {


    use anchor_spl::token::spl_token::instruction::transfer;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);

        let amm = &mut ctx.accounts.amm_account;
        let _token_a = ctx.accounts.mint_a.key();
        let _token_b = ctx.accounts.mint_b.key();
        amm.reserve_a=0;
        amm.reserve_b=0;
        amm.bump = ctx.bumps.amm_account;
        // you will later set:
        // let amm = &mut ctx.accounts.amm_account;
        // amm.token_a = ctx.accounts.mint_a.key();
        // amm.token_b = ctx.accounts.mint_b.key();
        // amm.reserve_a = 0;
        // amm.reserve_b = 0;
        // amm.bump = *ctx.bumps.get("amm_account").unwrap();

        Ok(())
    }

    pub fn addliquidity(ctx:Context<AddLiquidityPool>,amount1 : u64,amount2:u64)->Result<()>{
        let amm = &mut ctx.accounts.amm_account;
        require!(amount1> 0&& amount2>0,AmmError::InvalidAmount);

        let user_token_a = &ctx.accounts.user_token_a;
        let user_token_b = &ctx.accounts.user_token_b;
        let vault_a = &ctx.accounts.vault_a;
        let vault_b= &ctx.accounts.vault_b;
        let lp_mint = &ctx.accounts.lp_mint;
        let user_lp_token = &ctx.accounts.user_lp_token;
        let token_program = &ctx.accounts.token_program;

        let token_a_key = amm.token_a;
        let token_b_key = amm.token_b;
        let bump = amm.bump;

        let seeds: [&[u8]; 4] = [
            b"client",
            token_a_key.as_ref(),
            token_b_key.as_ref(),
            &[bump],
        ];
        let signer_seeds: [&[&[u8]]; 1] = [&seeds];

        let liquidity_minted: u64;
        // adding liquidity for the first time 
        if amm.reserve_a==0 && amm.reserve_b==0 {
            amm.reserve_a= amm.reserve_a.checked_add(amount1).ok_or(AmmError::Overflow)?;
            amm.reserve_b= amm.reserve_b.checked_add(amount2).ok_or(AmmError::Overflow)?;

            liquidity_minted = amount1;

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
        liquidity_minted = (amm.reserve_a as u128)
            .checked_mul(amount1 as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(amm.reserve_a as u128)
            .ok_or(AmmError::Overflow)? as u64;

        // update reserves
        amm.reserve_a = amm.reserve_a.checked_add(amount1).ok_or(AmmError::Overflow)?;
        amm.reserve_b = amm.reserve_b.checked_add(amount2).ok_or(AmmError::Overflow)?;
        }
        // tokenA transfer from User to Liqudity Pool (PDA)
        anchor_spl::token::transfer(CpiContext::new(token_program.to_account_info(),
        anchor_spl::token::Transfer{
            from:user_token_a.to_account_info(),
            to: vault_a.to_account_info(),
            authority: ctx.accounts.signer.to_account_info()
        }
    ), amount1)?;

    // transfer tokenB from User to LP(PDA)

    // let transfixn2 =  ;
    anchor_spl::token::transfer(CpiContext::new(token_program.to_account_info(),
    anchor_spl::token::Transfer{
        from:user_token_b.to_account_info(),
        to: vault_b.to_account_info(),
        authority: ctx.accounts.signer.to_account_info()
    }
), amount2)?;
    // mint LP token for user 

    let mintContex = CpiContext::new_with_signer(token_program.to_account_info(), anchor_spl::token::MintTo{
        mint : ctx.accounts.lp_mint.to_account_info(),
        to : user_lp_token.to_account_info(),
        authority:amm.to_account_info()
    }, &signer_seeds);
    anchor_spl::token::mint_to(mintContex, liquidity_minted)?;
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
    InvalidRatio
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
