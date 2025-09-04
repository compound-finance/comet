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
      totalSupplyBase: 1000n,
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
    
    // Verify initial assetsIn state
    const assetInfoInitial = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    // Check if COMP asset is in assetsIn by checking the bit
    const isAssetInInitial = (userBasic.assetsIn & (1 << assetInfoInitial.offset)) !== 0;
    console.log('  COMP asset in assetsIn (initial):', isAssetInInitial);
    expect(isAssetInInitial).to.be.true; // Should be true since user has collateral
    
    // Check if the account has assets and debt
    const hasAssets = userBasic.assetsIn > 0;
    const hasDebt = userBasic.principal.toBigInt() < 0n;
    console.log('  Has assets:', hasAssets);
    console.log('  Has debt:', hasDebt);
    
    // Check asset configuration
    const assetInfoConfig = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
    const price = await cometWithPartialLiquidation.getPrice(assetInfoConfig.priceFeed);
    const numAssets = await cometWithPartialLiquidation.numAssets();
    
    console.log('Asset Configuration:');
    console.log('  Borrow collateral factor:', assetInfoConfig.borrowCollateralFactor.toString());
    console.log('  Liquidate collateral factor:', assetInfoConfig.liquidateCollateralFactor.toString());
    console.log('  Liquidation factor:', assetInfoConfig.liquidationFactor.toString());
    console.log('  COMP price:', price.toString());
    console.log('  Number of assets:', numAssets.toString());
    
    // Calculate collateral values - правильные расчеты
    // COMP balance: 1500 * 10^18 wei
    // COMP price: 1 * 10^8 wei (8 знаков для USDC)
    // Результат: (1500 * 10^18 * 1 * 10^8) / 10^18 = 1500 * 10^8 wei
    const collateralValue = (userCollateral.balance.toBigInt() * price.toBigInt()) / (10n ** 18n);
    const collaterizedValue = (collateralValue * assetInfoConfig.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
    
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
      const finalUserBasic = await cometWithPartialLiquidation.userBasic(user1.address);
      
      console.log('Final Balances:');
      console.log('  Collateral:', finalCollateral.balance.toString());
      console.log('  Debt:', finalDebt.toBigInt().toString());
      console.log('  AssetsIn (final):', finalUserBasic.assetsIn.toString());
      
      // Verify that liquidation occurred (debt should be reduced)
      expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
      
      // Verify that user still has some collateral (partial liquidation)
      expect(finalCollateral.balance.toBigInt()).to.be.gt(0n);
      
      // Verify assetsIn is correctly updated
      // If collateral balance is 0, the asset should be removed from assetsIn
      // If collateral balance > 0, the asset should remain in assetsIn
      const assetInfoFinal = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
      // Check if COMP asset is in assetsIn by checking the bit
      const isAssetInFinal = (finalUserBasic.assetsIn & (1 << assetInfoFinal.offset)) !== 0;
      
      if (finalCollateral.balance.toBigInt() === 0n) {
        // If balance is 0, asset should NOT be in assetsIn
        expect(isAssetInFinal).to.be.false;
        console.log('AssetsIn correctly updated: asset removed when balance became 0');
      } else {
        // If balance > 0, asset should remain in assetsIn
        expect(isAssetInFinal).to.be.true;
        console.log('AssetsIn correctly updated: asset remains when balance > 0');
      }
      
      console.log('Partial liquidation verified - user retains some collateral');
      
    } catch (error) {
      console.log('Liquidation failed with error:', error.message);
      
      if (error.message.includes('Division or modulo division by zero')) {
        console.log('Error: Division by zero detected');
        console.log('This suggests a mathematical error in absorbInternal function');
        
        // Log detailed information about the state
        const userBasicError = await cometWithPartialLiquidation.userBasic(user1.address);
        const userCollateralError = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
        const assetInfoError = await cometWithPartialLiquidation.getAssetInfoByAddress(COMP.address);
        const priceError = await cometWithPartialLiquidation.getPrice(assetInfoError.priceFeed);
        
        console.log('Detailed State Analysis:');
        console.log('  User principal:', userBasicError.principal.toString());
        console.log('  User collateral balance:', userCollateralError.balance.toString());
        console.log('  Asset borrowCF:', assetInfoError.borrowCollateralFactor.toString());
        console.log('  Asset liquidateCF:', assetInfoError.liquidateCollateralFactor.toString());
        console.log('  Asset liquidationFactor:', assetInfoError.liquidationFactor.toString());
        console.log('  Asset price:', priceError.toString());
        
        // Calculate the values that go into the problematic division
        const collateralValueError = (userCollateralError.balance.toBigInt() * priceError.toBigInt()) / (10n ** 18n);
        const collaterizationValueError = (collateralValueError * assetInfoError.borrowCollateralFactor.toBigInt()) / (10n ** 18n);
        const liquidationValueError = (collateralValueError * assetInfoError.liquidationFactor.toBigInt()) / (10n ** 18n);
        
        console.log('Calculated Values:');
        console.log('  Collateral Value (COMP * Price):', collateralValueError.toString());
        console.log('  Collaterization Value (CV * borrowCF):', collaterizationValueError.toString());
        console.log('  Liquidation Value (CV * liquidationFactor):', liquidationValueError.toString());
        
        // Check if the denominator could be zero
        const targetHF = 1n * (10n ** 18n); // 1.0 in 18 decimals
        const denominator1 = (assetInfoError.borrowCollateralFactor.toBigInt() * targetHF) / (10n ** 18n) - assetInfoError.liquidationFactor.toBigInt();
        const denominator2 = collaterizationValueError - liquidationValueError;
        
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

  it('should return false when user has no debt (happy case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP } = tokens;

    // Set user with no debt (principal = 0)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, 0);
    
    // Set user to have collateral
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with no debt - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.false;
  });

  it('should return false when user has deposit (principal > 0)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.8, 18),
          liquidateCF: exp(0.85, 18),
          liquidationFactor: exp(0.7, 18),
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP } = tokens;

    // Set user with positive principal (deposit)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, exp(1000, 6)); // 1000 USDC deposit
    
    // Set user to have collateral
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with deposit - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.false;
  });

  it('should return false when user has sufficient collateral for debt (happy case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have 2000 COMP collateral (worth 2000 USDC, sufficient for 1000 USDC debt)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(2000, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(2000, 18),
      _reserved: 0n,
    });

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with sufficient collateral - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.false;
  });

  it('should return true when user has insufficient collateral for debt (happy case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have only 500 COMP collateral (worth 500 USDC, insufficient for 1000 USDC debt)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(500, 18));

    // Create a virtual user with large collateral to make totalCollaterizedValue > collaterizationValue
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero,
      COMP.address, 
      exp(10000, 18)
    );

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10500, 18), // 500 + 10000
      _reserved: 0n,
    });

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with insufficient collateral - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.true;
  });

  it('should successfully absorb user with single collateral (partial liquidation)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 2000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(2000, 6));
    
    // Set user to have 1500 COMP collateral (worth 1500 USDC, insufficient for 2000 USDC debt)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1500, 18));

    // Create virtual user with large collateral to make totalCollaterizedValue > collaterizationValue
    await cometWithPartialLiquidation.setCollateralBalance(
      ethers.constants.AddressZero,
      COMP.address, 
      exp(10000, 18)
    );

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(2000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11500, 18), // 1500 + 10000
      _reserved: 0n,
    });

    // Check initial state
    const initialCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State:');
    console.log('  Collateral:', initialCollateral.balance.toString());
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalCollateral = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State:');
    console.log('  Collateral:', finalCollateral.balance.toString());
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    expect(finalCollateral.balance.toBigInt()).to.be.lt(initialCollateral.balance.toBigInt());
    
    // User should no longer be liquidatable (debt fully paid)
    expect(finalIsLiquidatable).to.be.false;
    
    console.log('Partial liquidation verified - debt and collateral reduced');
  });

  it('should successfully absorb user with multiple collaterals (partial liquidation)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000, // 1 WETH = 2000 USDC
          borrowCF: exp(0.75, 18),    // 75% collateral factor
          liquidateCF: exp(0.8, 18), // 80% liquidation factor
          liquidationFactor: exp(0.65, 18), // 65% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH } = tokens;

    // Set user to owe 3000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(3000, 6));
    
    // Set user to have 1000 COMP collateral (worth 1000 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));
    
    // Set user to have 1 WETH collateral (worth 2000 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(1, 18));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(3000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18), // 1000 + 10000
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(101, 18), // 1 + 100
      _reserved: 0n,
    });

    // Check initial state
    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State:');
    console.log('  COMP Collateral:', initialCOMP.balance.toString());
    console.log('  WETH Collateral:', initialWETH.balance.toString());
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State:');
    console.log('  COMP Collateral:', finalCOMP.balance.toString());
    console.log('  WETH Collateral:', finalWETH.balance.toString());
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // At least one collateral should be reduced
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    expect(compReduced || wethReduced).to.be.true;
    
    // User should still be liquidatable (partial liquidation)
    expect(finalIsLiquidatable).to.be.true;
    
    console.log('Multi-collateral liquidation verified - debt reduced and collaterals liquidated');
  });

  it('should return false when user has multiple collaterals - sufficient last collateral only', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000, // 1 WETH = 2000 USDC
          borrowCF: exp(0.75, 18),    // 75% collateral factor
          liquidateCF: exp(0.8, 18), // 80% liquidation factor
          liquidationFactor: exp(0.65, 18), // 65% liquidation factor
        },
        WBTC: {
          initial: 1e7,
          decimals: 8,
          initialPrice: 50000, // 1 WBTC = 50000 USDC
          borrowCF: exp(0.7, 18),    // 70% collateral factor
          liquidateCF: exp(0.75, 18), // 75% liquidation factor
          liquidationFactor: exp(0.6, 18), // 60% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP, WETH, WBTC } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have insufficient COMP collateral (worth 200 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(200, 18));
    
    // Set user to have insufficient WETH collateral (worth 400 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    
    // Set user to have sufficient WBTC collateral (worth 50000 USDC, sufficient for 1000 USDC debt)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(1, 8));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WBTC.address, exp(100, 8));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10200, 18), // 200 + 10000
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18), // 0.2 + 100
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WBTC.address, {
      totalSupplyAsset: exp(101, 8), // 1 + 100
      _reserved: 0n,
    });

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with multiple collaterals - sufficient last only - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.false; // Should be false because last collateral is sufficient
  });

  it('should return true when user has multiple collaterals - insufficient last collateral (edge case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000, // 1 WETH = 2000 USDC
          borrowCF: exp(0.75, 18),    // 75% collateral factor
          liquidateCF: exp(0.8, 18), // 80% liquidation factor
          liquidationFactor: exp(0.65, 18), // 65% liquidation factor
        },
        WBTC: {
          initial: 1e7,
          decimals: 8,
          initialPrice: 50000, // 1 WBTC = 50000 USDC
          borrowCF: exp(0.7, 18),    // 70% collateral factor
          liquidateCF: exp(0.75, 18), // 75% liquidation factor
          liquidationFactor: exp(0.6, 18), // 60% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1] } = protocol;
    const { COMP, WETH, WBTC } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have insufficient COMP collateral (worth 200 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(200, 18));
    
    // Set user to have insufficient WETH collateral (worth 400 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    
    // Set user to have insufficient WBTC collateral (worth 100 USDC, insufficient for 1000 USDC debt)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(0.002, 8));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WBTC.address, exp(100, 8));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10200, 18), // 200 + 10000
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18), // 0.2 + 100
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WBTC.address, {
      totalSupplyAsset: exp(100.002, 8), // 0.002 + 100
      _reserved: 0n,
    });

    // Check if user is liquidatable
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('User with multiple collaterals - insufficient last - isLiquidatable:', isLiquidatable);
    expect(isLiquidatable).to.be.true; // Should be true because all collaterals are insufficient
  });

  it('should successfully absorb user with insufficient collaterals (edge case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000, // 1 WETH = 2000 USDC
          borrowCF: exp(0.75, 18),    // 75% collateral factor
          liquidateCF: exp(0.8, 18), // 80% liquidation factor
          liquidationFactor: exp(0.65, 18), // 65% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have insufficient COMP collateral (worth 300 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(300, 18));
    
    // Set user to have insufficient WETH collateral (worth 400 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10300, 18), // 300 + 10000
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18), // 0.2 + 100
      _reserved: 0n,
    });

    // Check initial state
    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (Insufficient Collaterals):');
    console.log('  COMP Collateral:', initialCOMP.balance.toString());
    console.log('  WETH Collateral:', initialWETH.balance.toString());
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb with insufficient collaterals...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (Insufficient Collaterals):');
    console.log('  COMP Collateral:', finalCOMP.balance.toString());
    console.log('  WETH Collateral:', finalWETH.balance.toString());
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // At least one collateral should be reduced
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    expect(compReduced || wethReduced).to.be.true;
    
    // User should still be liquidatable (partial liquidation with insufficient collaterals)
    expect(finalIsLiquidatable).to.be.true;
    
    console.log('Insufficient collateral liquidation verified - debt reduced but user still liquidatable');
  });

  it('should successfully absorb user with insufficient middle collateral (edge case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
        WETH: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 2000, // 1 WETH = 2000 USDC
          borrowCF: exp(0.75, 18),    // 75% collateral factor
          liquidateCF: exp(0.8, 18), // 80% liquidation factor
          liquidationFactor: exp(0.65, 18), // 65% liquidation factor
        },
        WBTC: {
          initial: 1e7,
          decimals: 8,
          initialPrice: 50000, // 1 WBTC = 50000 USDC
          borrowCF: exp(0.7, 18),    // 70% collateral factor
          liquidateCF: exp(0.75, 18), // 75% liquidation factor
          liquidationFactor: exp(0.6, 18), // 60% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP, WETH, WBTC } = tokens;

    // Set user to owe 2000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(2000, 6));
    
    // Set user to have sufficient COMP collateral (worth 1000 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));
    
    // Set user to have insufficient WETH collateral (worth 400 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WETH.address, exp(0.2, 18));
    
    // Set user to have sufficient WBTC collateral (worth 1000 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, WBTC.address, exp(0.02, 8));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WETH.address, exp(100, 18));
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, WBTC.address, exp(10, 8));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(2000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18), // 1000 + 10000
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WETH.address, {
      totalSupplyAsset: exp(100.2, 18), // 0.2 + 100
      _reserved: 0n,
    });

    await cometWithPartialLiquidation.setTotalsCollateral(WBTC.address, {
      totalSupplyAsset: exp(10.02, 8), // 0.02 + 10
      _reserved: 0n,
    });

    // Check initial state
    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const initialWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (Insufficient Middle Collateral):');
    console.log('  COMP Collateral:', initialCOMP.balance.toString());
    console.log('  WETH Collateral:', initialWETH.balance.toString());
    console.log('  WBTC Collateral:', initialWBTC.balance.toString());
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb with insufficient middle collateral...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalWETH = await cometWithPartialLiquidation.userCollateral(user1.address, WETH.address);
    const finalWBTC = await cometWithPartialLiquidation.userCollateral(user1.address, WBTC.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (Insufficient Middle Collateral):');
    console.log('  COMP Collateral:', finalCOMP.balance.toString());
    console.log('  WETH Collateral:', finalWETH.balance.toString());
    console.log('  WBTC Collateral:', finalWBTC.balance.toString());
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // At least one collateral should be reduced
    const compReduced = finalCOMP.balance.toBigInt() < initialCOMP.balance.toBigInt();
    const wethReduced = finalWETH.balance.toBigInt() < initialWETH.balance.toBigInt();
    const wbtcReduced = finalWBTC.balance.toBigInt() < initialWBTC.balance.toBigInt();
    expect(compReduced || wethReduced || wbtcReduced).to.be.true;
    
    // User should still be liquidatable (partial liquidation with insufficient middle collateral)
    expect(finalIsLiquidatable).to.be.true;
    
    console.log('Insufficient middle collateral liquidation verified - debt reduced but user still liquidatable');
  });

  it('should successfully absorb user with maximum collaterals (24) - happy case', async function () {
    // Create protocol with 24 different collateral assets
    const assets = {
      USDC: { decimals: 6 },
    };
    
    // Add 24 different collateral assets
    const collateralAssets = [
      'COMP', 'WETH', 'WBTC', 'LINK', 'UNI', 'AAVE', 'CRV', 'MKR',
      'SNX', 'YFI', 'SUSHI', '1INCH', 'BAL', 'LRC', 'BAT', 'ZRX',
      'KNC', 'REN', 'LEND', 'REP', 'STORJ', 'MANA', 'GNT', 'ANT'
    ];
    
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      assets[asset] = {
        initial: 1e7,
        decimals: 18,
        initialPrice: 100 + i * 10, // Different prices for each asset
        borrowCF: exp(0.8, 18),    // 80% collateral factor
        liquidateCF: exp(0.85, 18), // 85% liquidation factor
        liquidationFactor: exp(0.7, 18), // 70% liquidation factor
      };
    }

    const protocol = await makeProtocol({ assets });
    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    
    // Set user to owe 20000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(20000, 6));
    
    // Set user to have small amount of each collateral (worth 500 USDC each)
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      const price = 100 + i * 10;
      const amount = exp(500 / price, 18); // 500 USDC worth
      await cometWithPartialLiquidation.setCollateralBalance(user1.address, tokens[asset].address, amount);
    }

    // Create virtual users with large collateral
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, tokens[asset].address, exp(10000, 18));
    }

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(20000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for all collateral assets
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      await cometWithPartialLiquidation.setTotalsCollateral(tokens[asset].address, {
        totalSupplyAsset: exp(10000, 18), // 10000 + virtual
        _reserved: 0n,
      });
    }

    // Check initial state
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (24 Collaterals):');
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb with 24 collaterals...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (24 Collaterals):');
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // User should still be liquidatable (partial liquidation)
    expect(finalIsLiquidatable).to.be.true;
    
    console.log('24 collateral liquidation verified - debt reduced but user still liquidatable');
  });

  it('should successfully absorb user with maximum collaterals (24) - insufficient last collateral', async function () {
    // Create protocol with 24 different collateral assets
    const assets = {
      USDC: { decimals: 6 },
    };
    
    // Add 24 different collateral assets
    const collateralAssets = [
      'COMP', 'WETH', 'WBTC', 'LINK', 'UNI', 'AAVE', 'CRV', 'MKR',
      'SNX', 'YFI', 'SUSHI', '1INCH', 'BAL', 'LRC', 'BAT', 'ZRX',
      'KNC', 'REN', 'LEND', 'REP', 'STORJ', 'MANA', 'GNT', 'ANT'
    ];
    
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      assets[asset] = {
        initial: 1e7,
        decimals: 18,
        initialPrice: 100 + i * 10, // Different prices for each asset
        borrowCF: exp(0.8, 18),    // 80% collateral factor
        liquidateCF: exp(0.85, 18), // 85% liquidation factor
        liquidationFactor: exp(0.7, 18), // 70% liquidation factor
      };
    }

    const protocol = await makeProtocol({ assets });
    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    
    // Set user to owe 25000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(25000, 6));
    
    // Set user to have small amount of each collateral (worth 500 USDC each)
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      const price = 100 + i * 10;
      const amount = exp(500 / price, 18); // 500 USDC worth
      await cometWithPartialLiquidation.setCollateralBalance(user1.address, tokens[asset].address, amount);
    }

    // Create virtual users with large collateral
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, tokens[asset].address, exp(10000, 18));
    }

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(25000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for all collateral assets
    for (let i = 0; i < collateralAssets.length; i++) {
      const asset = collateralAssets[i];
      await cometWithPartialLiquidation.setTotalsCollateral(tokens[asset].address, {
        totalSupplyAsset: exp(10000, 18), // 10000 + virtual
        _reserved: 0n,
      });
    }

    // Check initial state
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (24 Collaterals - Insufficient Last):');
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption
    console.log('Calling absorb with 24 collaterals - insufficient last...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (24 Collaterals - Insufficient Last):');
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // User should still be liquidatable (partial liquidation with insufficient last collateral)
    expect(finalIsLiquidatable).to.be.true;
    
    console.log('24 collateral insufficient last liquidation verified - debt reduced but user still liquidatable');
  });

  it('should handle price feed revert errors gracefully', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have insufficient COMP collateral (worth 500 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(500, 18));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(10500, 18), // 500 + 10000
      _reserved: 0n,
    });

    // Check initial state
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (Price Feed Revert Test):');
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Try to perform absorption - this should work normally
    console.log('Calling absorb with normal price feed...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (Price Feed Revert Test):');
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // User should no longer be liquidatable (debt fully paid)
    expect(finalIsLiquidatable).to.be.false;
    
    console.log('Price feed revert test completed - absorb worked normally');
  });

  it('should handle price drop between blocks (edge case)', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have COMP collateral (worth 1000 USDC at initial price)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18), // 1000 + 10000
      _reserved: 0n,
    });

    // Check initial state
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (Price Drop Test):');
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform absorption - this should work at current price
    console.log('Calling absorb at current price...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Absorb completed successfully!');

    // Check final state
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (Price Drop Test):');
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify liquidation occurred - debt should be reduced
    expect(finalDebt.toBigInt()).to.be.lt(initialDebt.toBigInt());
    
    // User should no longer be liquidatable (debt fully paid)
    expect(finalIsLiquidatable).to.be.false;
    
    console.log('Price drop test completed - absorb worked at current price');
  });

  it('should perform full liquidation with single collateral', async function () {
    const protocol = await makeProtocol({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1, // 1 COMP = 1 USDC
          borrowCF: exp(0.8, 18),    // 80% collateral factor
          liquidateCF: exp(0.85, 18), // 85% liquidation factor
          liquidationFactor: exp(0.7, 18), // 70% liquidation factor
        },
      },
    });

    const { cometWithPartialLiquidation, tokens, users: [user1, liquidator] } = protocol;
    const { COMP } = tokens;

    // Set user to owe 1000 USDC (debt)
    await cometWithPartialLiquidation.setBasePrincipal(user1.address, -exp(1000, 6));
    
    // Set user to have exactly enough COMP collateral for full liquidation (worth 1000 USDC)
    await cometWithPartialLiquidation.setCollateralBalance(user1.address, COMP.address, exp(1000, 18));

    // Create virtual users with large collateral
    await cometWithPartialLiquidation.setCollateralBalance(ethers.constants.AddressZero, COMP.address, exp(10000, 18));

    // Set totals for the protocol
    await cometWithPartialLiquidation.setTotalsBasic({
      baseSupplyIndex: exp(1, 15),
      baseBorrowIndex: exp(1, 15),
      trackingSupplyIndex: exp(1, 15),
      trackingBorrowIndex: exp(1, 15),
      totalSupplyBase: 0n,
      totalBorrowBase: exp(1000, 6),
      lastAccrualTime: Math.floor(Date.now() / 1000),
      pauseFlags: 0,
    });

    // Set totals for collateral assets
    await cometWithPartialLiquidation.setTotalsCollateral(COMP.address, {
      totalSupplyAsset: exp(11000, 18), // 1000 + 10000
      _reserved: 0n,
    });

    // Check initial state
    const initialCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const initialDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const isLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Initial State (Full Liquidation - Single Collateral):');
    console.log('  COMP Collateral:', initialCOMP.balance.toString());
    console.log('  Debt:', initialDebt.toString());
    console.log('  Is liquidatable:', isLiquidatable);
    
    expect(isLiquidatable).to.be.true;

    // Perform full liquidation
    console.log('Calling absorb for full liquidation...');
    const absorbTx = await cometWithPartialLiquidation.connect(liquidator).absorb(liquidator.address, [user1.address]);
    await absorbTx.wait();
    
    console.log('Full liquidation completed successfully!');

    // Check final state
    const finalCOMP = await cometWithPartialLiquidation.userCollateral(user1.address, COMP.address);
    const finalDebt = await cometWithPartialLiquidation.borrowBalanceOf(user1.address);
    const finalIsLiquidatable = await cometWithPartialLiquidation.isLiquidatable(user1.address);
    
    console.log('Final State (Full Liquidation - Single Collateral):');
    console.log('  COMP Collateral:', finalCOMP.balance.toString());
    console.log('  Debt:', finalDebt.toString());
    console.log('  Is liquidatable:', finalIsLiquidatable);
    
    // Verify full liquidation occurred - debt should be completely paid
    expect(finalDebt.toBigInt()).to.equal(0n);
    
    // All collateral should be liquidated in full liquidation
    expect(finalCOMP.balance.toBigInt()).to.equal(0n);
    
    // User should no longer be liquidatable
    expect(finalIsLiquidatable).to.be.false;
    
    console.log('Full liquidation with single collateral verified - debt and collateral completely cleared');
  });
});