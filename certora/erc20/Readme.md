# ERC20 Testing

The erc20.spec in this directory tests ERC20 tokens for correct behavior, such as
correct balances after transfers, correct allowance changes, valid balances changes,
no change in total supply and others.

We also added scripts for running the spec on the code of 3 common tokens deployed on mainnet:
USDC, Sushi and FTT.

The spec doesn't pass completely on any of these tokens, because each of them has some functions that
violate the rules: mint/burn that change total supply, pause/blacklist that violate correct transfer rules
and others. The point is to understand why the rule fails in each case and make sure that each failure
is as expected.

These example also show how it's not feasible to write a generic and extensive erc20 that works on all the tokens.
Most common tokens in use have features that "break" the generic rules. Mint/burn, pause, blacklist, transfer/approve
by authorization (signature) and others. These functions have different names in the code of tokens, so we cannot
test everything in the spec.

So the idea is to run a general spec and make sure that failures are as expected, and possibly to modify the script
for each token that interests us. E.g., add specific rules for a pausable token, for a token with a blacklist feature,
etc.

## USDC 

USDC is pausable and has blacklist features. Hence, the Certora prover finds counterexamples
to several rules. 

For example, we test that a transfer fails only when the amount is too high or the recipient is 0.
But, with USDC a transfer might fail when the token state is paused or the recipient is blacklisted.

## FTT

FTT has a function burnFrom(), hence a rule for no change in total supply and other rules "fail" - as
in Certora prover finds the correct counterexample.

## Sushi

Sushi has a mint function, which changes total supply, hence the rule for no changes to total supply fails
on this function.


