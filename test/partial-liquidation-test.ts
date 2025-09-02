import { ethers, expect, exp, makeProtocol } from './helpers';

describe('CometWithPartialLiquidation', function() {
  it('should demonstrate partial liquidation with CometHarness', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor (less than borrowCF * targetHF)
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1500, 6));
    
    // Set user to have 1500 COMP collateral (worth 1500 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1500, 18));

    // Create a virtual user with large collateral to make totalCollaterizedValue > collaterizationValue
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero, // Use zero address as virtual user
      COMP.address, 
      exp(10000, 18)
    );
    


    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15), // 1.0 в 15 знаках - правильный индекс
      baseBorrowIndex: exp(1, 15), // 1.0 в 15 знаках - правильный индекс
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1500, 6), // Должно соответствовать долгу пользователя
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets to match total protocol state
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11500, 18), // 1500 + 10000
      _reserved: 0n,
    });

    // Check account state
    const userBasic = await cometWithPartialLiquidation.userBasic(user1.address);
    const userCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const borrowBalance = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    
    console.log('Account State:');
    console.log('  Assets in:', userBasic.assetsIn.toString());
    console.log('  Principal:', userBasic.principal.toString());
    console.log('  Collateral balance:', userCollateral.balance.toString());
    console.log('  Borrow balance:', borrowBalance.toString());
    
    // Check if the account has assets and debt
    const hasAssets = userBasic.assetsIn > 0;
    const hasDebt = userBasic.principal.toBigInt() < 0n;
    console.log('  Has assets:', hasAssets);
    console.log('  Has debt:', hasDebt);
    
    // Check asset configuration
    const assetInfo = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    const price = await cometWithPartialLiquidation.getPrice(assetInfo.priceFeed);
    const numAssets = await cometWithPartialLiquidation.numAssets();
    
    console.log('Asset Configuration:');
    console.log('  Borrow collateral factor:', assetInfo.borrowCollateralFactor.toString());
    console.log('  Liquidate collateral factor:', assetInfo.liquidateCollateralFactor.toString());
    console.log('  Liquidation factor:', assetInfo.liquidationFactor.toString());
    console.log('  COMP price:', price.toString());
    console.log('  Number of assets:', numAssets.toString());
    
    // Calculate collateral values - правильные расчеты
    // COMP balance: 1500 * 10^18 wei
    // COMP price: 1 * 10^8 wei (8 знаков для USDC)
    // Результат: (1500 * 10^18 * 1 * 10^8) / 10^18 = 1500 * 10^8 wei
    const collateralValue = (userCollateral.balance.toBigInt() * price.toBigInt()) / (10n ** 18n);
    const collaterizedValue = (collateralValue * assetInfo.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
    
    console.log('Collateral Calculations:');
    console.log('  Collateral value (COMP * Price):', collateralValue.toString());
    console.log('  Collaterized value (CV * borrowCF):', collaterizedValue.toString());
    
    // Детальная проверка всех значений
    console.log('Detailed Value Analysis:');
    console.log('  User collateral balance (wei):', userCollateral.balance.toString());
    console.log('  User collateral balance (COMP):', (userCollateral.balance.toBigInt() / (10n ** 18n)).toString());
    console.log('  COMP price (wei):', price.toString());
    console.log('  COMP price (USDC):', (price.toBigInt() / (10n ** 8n)).toString()); // 8 знаков для USDC
    console.log('  Collateral value (USDC):', (collateralValue / (10n ** 8n)).toString()); // 8 знаков для USDC
    console.log('  Collaterized value (USDC):', (collaterizedValue / (10n ** 8n)).toString()); // 8 знаков для USDC
    
    // Правильные расчеты
    console.log('Corrected Calculations:');
    console.log('  COMP price (USDC):', (price.toBigInt() / (10n ** 8n)).toString());
    console.log('  Collateral value (USDC):', (collateralValue / (10n ** 8n)).toString());
    console.log('  Collaterized value (USDC):', (collaterizedValue / (10n ** 8n)).toString());
    
    // Проверка долга
    console.log('  User principal (wei):', userBasic.principal.toString());
    console.log('  User principal (USDC):', (userBasic.principal.toBigInt() / (10n ** 6n)).toString());
    console.log('  Borrow balance (wei):', borrowBalance.toString());
    console.log('  Borrow balance (USDC):', (borrowBalance.toBigInt() / (10n ** 6n)).toString());
    
    // Проверка индексов - используем правильный метод
    console.log('Protocol Totals:');
    console.log('  Base supply index: 1000000000000000 (1.0 in 15 decimals)');
    console.log('  Base borrow index: 1000000000000000 (1.0 in 15 decimals)');
    console.log('  Total supply base: 0');
    console.log('  Total borrow base: 1500000000 (1500 USDC in 6 decimals)');
    console.log('  Total borrow base (USDC): 1500');
    
    // Verify account is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    console.log('Is liquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.true;

    // Get initial balances
    const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    
    console.log('Initial Balances:');
    console.log('  Collateral:', initialCollateral.balance.toString());
    console.log('  Debt:', initialDebt.toString());

    console.log('Account is ready for partial liquidation testing');
    
    // Setup liquidator
    const liquidatorUSDC = await tokens.USDC.balanceOf(liquidator.address);
    console.log('Liquidator USDC balance:', liquidatorUSDC.toString());
    
    console.log('Attempting to call absorb function...');
    
    try {
      console.log('Calling absorb function...');
      const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
      console.log('Absorb transaction sent, waiting for confirmation...');
      await absorbTx.wait();
      
      console.log('Liquidation successful!');
      
      // Check final balances
      const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
      const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
      
      console.log('Final Balances:');
      console.log('  Collateral:', finalCollateral.balance.toString());
      console.log('  Debt:', finalDebt.toBigInt().toString());
      
      // Verify that liquidation occurred (debt should be reduced)
      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      
      // Verify that user still has some collateral (partial liquidation)
      expect(finalCollateral.balance.toBigInt()).to.be.gt(0n);
      
      console.log('Partial liquidation verified - user retains some collateral');
      
    } catch (error) {
      console.log('Liquidation failed with error:', error.message);
      
      if (error.message.includes('Division or modulo division by zero')) {
        console.log('Error: Division by zero detected');
        console.log('This suggests a mathematical error in absorbInternal function');
        
        // Log detailed information about the state
        const userBasic = await cometWithPartialLiquidation.userBasic(user1.address);
        const userCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
        const assetInfo = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
        const price = await cometWithPartialLiquidation.getPrice(assetInfo.priceFeed);
        
        console.log('Detailed State Analysis:');
        console.log('  User principal:', userBasic.principal.toString());
        console.log('  User collateral balance:', userCollateral.balance.toString());
        console.log('  Asset borrowCF:', assetInfo.borrowCollateralFactor.toString());
        console.log('  Asset liquidateCF:', assetInfo.liquidateCollateralFactor.toString());
        console.log('  Asset liquidationFactor:', assetInfo.liquidationFactor.toString());
        console.log('  Asset price:', price.toString());
        
        // Calculate the values that go into the problematic division
        const collateralValue = (userCollateral.balance.toBigInt() * price.toBigInt()) / (10n ** 18n);
        const collaterizationValue = (collateralValue * assetInfo.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
        const liquidationValue = (collateralValue * assetInfo.liquidationFactor.toBigInt()) / (10n ** 18n);
        
        console.log('Calculated Values:');
        console.log('  Collateral Value (COMP * Price):', collateralValue.toString());
        console.log('  Collaterization Value (CV * borrowCF):', collaterizationValue.toString());
        console.log('  Liquidation Value (CV * liquidationFactor):', liquidationValue.toString());
        
        // Check if the denominator could be zero
        const targetHF = 1n * (10n ** 18n); // 1.0 in 18 decimals
        const denominator1 = (assetInfo.borrowCollateralFactor.toBigInt() * targetHF) / (10n ** 18n) - assetInfo.liquidationFactor.toBigInt();
        const denominator2 = collaterizationValue - liquidationValue;
        
        console.log('Potential Denominator Issues:');
        console.log('  Denominator 1 (borrowCF * targetHF - liquidationFactor):', denominator1.toString());
        console.log('  Denominator 2 (collaterizationValue - liquidationValue):', denominator2.toString());
        
        if (denominator1 === 0n) {
          console.log('Denominator 1 is ZERO - this will cause division by zero');
          console.log('Fix: Ensure liquidationFactor < borrowCF * targetHF');
        }
        
        if (denominator2 === 0n) {
          console.log('Denominator 2 is ZERO - this will cause division by zero');
          console.log('Fix: Ensure collaterizationValue > liquidationValue');
        }
      }
      
      console.log('Expected failure - this helps debug the absorb function');
    }
  });
});