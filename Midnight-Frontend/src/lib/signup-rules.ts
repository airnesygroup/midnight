/** New accounts one network address may create within the window; past it, sign-up waits. No confirmation emails are sent. */
export const MAX_ACCOUNTS_PER_ADDRESS = 3;
/** Window over which accounts from the same address are counted. */
export const SIGNUP_WINDOW_HOURS = 24;

export const signupLimitReached = (accountsFromAddress: number) =>
  accountsFromAddress >= MAX_ACCOUNTS_PER_ADDRESS;
