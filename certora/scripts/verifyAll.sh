patch -p1 ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch
./certora/scripts/verifyAssetInfo.sh
./certora/scripts/verifyComet.sh
./certora/scripts/verifyCometAbsorbBuyCollateral.sh
./certora/scripts/verifyCometExt.sh
./certora/scripts/verifyCometTotalsAndBalances.sh
./certora/scripts/verifyCometWithdrawSupply.sh
./certora/scripts/verifyGovernance.sh
./certora/scripts/verifyInterestComputation.sh
./certora/scripts/verifyPause.sh
./certora/scripts/verifyPauseGuardians.sh
./certora/scripts/verifyUserAssetIn.sh
patch -p1 -R ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch 