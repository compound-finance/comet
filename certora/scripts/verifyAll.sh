patch -p1 ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch
sh certora/scripts/verifyAssetInfo.sh
sh certora/scripts/verifyComet.sh
sh certora/scripts/verifyCometAbsorbBuyCollateral.sh
sh certora/scripts/verifyCometExt.sh
sh certora/scripts/verifyCometTotalsAndBalances.sh
sh certora/scripts/verifyCometWithdrawSupply.sh
sh certora/scripts/verifyGovernance.sh
sh certora/scripts/verifyInterestComputation.sh
sh certora/scripts/verifyPause.sh
sh certora/scripts/verifyPauseGuardians.sh
sh certora/scripts/verifyUserAssetIn.sh
patch -p1 -R ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch 