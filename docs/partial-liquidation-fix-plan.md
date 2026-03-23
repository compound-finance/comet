# Partial Liquidation — Fix Plan

Кожен пункт описує проблему, правильне рішення згідно з RFC та конкретні зміни у коді.

---

## Fix 1 — Виправити чисельник формули (Bug 1 + Bug 2)

### Проблема

Рядок 1174 використовує неправильну змінну (`totalCollaterizedValue2`, LF-зважена) і інвертований знак.

**Поточний код:**
```solidity
liquidationData.seizedValue =
    (liquidationData.totalCollaterizedValue2 - requiredCollateralValue) * FACTOR_SCALE
    / (mulFactor(assetInfo.liquidationFactor, targetHF) - assetInfo.borrowCollateralFactor);
```

### RFC formula 13 (адаптована до code-convention)

```
Δ_raw_USD = (targetHF × debt_remaining − totalCV_CF) / (LP × targetHF − CF)
```

де `totalCV_CF = totalCollaterizedValue` (CF-зважений, вже оновлений у циклі), `debt_remaining = uint256(-debt) - deltaValue`.

### Виправлення

```solidity
// ПРАВИЛЬНО: чисельник — (targetHF × debt − totalCV_CF), знаменник — (LP × targetHF − CF)
uint256 debtRemaining = uint256(-debt) - deltaValue;
uint256 rawCollateralUSD = (mulFactor(debtRemaining, targetHF) - liquidationData.totalCollaterizedValue)
    * FACTOR_SCALE
    / (mulFactor(assetInfo.liquidationFactor, targetHF) - assetInfo.borrowCollateralFactor);
```

### Чому це правильно

Для ліквідованого акаунту: `HF_code = totalCV_CF / debt < 1 < targetHF`.
Тому `targetHF × debt > totalCV_CF` → чисельник завжди додатній.
При валідній конфігурації (`LP × targetHF > CF`) знаменник теж додатній → `Δ > 0`. ✓

---

## Fix 2 — Виправити семантику `seizedValue` та `seizeAmount` (Bug 3 + Bug 4)

### Проблема

У partial-шляху `seizedValue` трактується як raw USD (`Δ`), але `deltaValue` повинен накопичувати **зменшення боргу** = `Δ × LP`. У full-шляху `seizedValue = rawUSD × LP` — правильно. Ця невідповідність дає хибний залишок боргу при змішаному сценарії (повне + часткове вилучення).

Крім того, після виправлення `seizedValue = Δ × LP` не можна використовувати `seizeAmount = seizedValue / price` — треба `seizeAmount = rawCollateralUSD / price`.

### Виправлення

```solidity
// rawCollateralUSD — скільки USD вилучаємо (сирий, без LP)
uint256 rawCollateralUSD = /* формула з Fix 1 */;

// Кількість токенів (незалежно від LP)
liquidationData.seizeAmount = divPrice(rawCollateralUSD, getPrice(assetInfo.priceFeed), assetInfo.scale);

// Зменшення боргу (аналогічно full-шляху: rawUSD × LP)
liquidationData.seizedValue = mulFactor(rawCollateralUSD, assetInfo.liquidationFactor);

// deltaValue += seizedValue — правильне погашення боргу ✓
```

### Перевірка узгодженості з full-шляхом

| | Full seizure | Partial seizure (після fix) |
|---|---|---|
| `seizeAmount` | `balance` (всі токени) | `rawCollateralUSD / price` |
| `seizedValue` | `rawUSD × LP` | `rawCollateralUSD × LP` |
| `deltaValue +=` | `rawUSD × LP` ✓ | `rawCollateralUSD × LP` ✓ |

---

## Fix 3 — Замінити guard-умову (Bug 5)

### Проблема

Поточний guard `totalCollaterizedValue2 >= requiredCollateralValue` ніколи не спрацьовує при `LF < liquidateCF` (більшість реальних конфігурацій). Правильна умова — перевірка знаменника та наявного балансу.

### Поточний guard (видаляємо)

```solidity
if (liquidationData.totalCollaterizedValue2 >= requiredCollateralValue) {
    // partial
} else {
    // full fallback
}
```

### Новий guard

```solidity
uint256 denom = mulFactor(assetInfo.liquidationFactor, targetHF);
bool denominatorPositive = denom > assetInfo.borrowCollateralFactor;

if (denominatorPositive) {
    denom -= assetInfo.borrowCollateralFactor;
    uint256 debtRemaining = uint256(-debt) - deltaValue;
    uint256 rawCollateralUSD = (mulFactor(debtRemaining, targetHF) - liquidationData.totalCollaterizedValue)
        * FACTOR_SCALE / denom;

    uint256 availableUSD = mulPrice(
        userCollateral[account][assetInfo.asset].balance,
        getPrice(assetInfo.priceFeed),
        assetInfo.scale
    );

    if (rawCollateralUSD <= availableUSD) {
        // Часткове вилучення: точно досягаємо targetHF
        liquidationData.seizeAmount = divPrice(rawCollateralUSD, getPrice(assetInfo.priceFeed), assetInfo.scale);
        liquidationData.seizedValue = mulFactor(rawCollateralUSD, assetInfo.liquidationFactor);
        liquidationData.currentHF = targetHF;
    } else {
        // Цього активу не вистачає — вилучаємо повністю, продовжуємо цикл
        // (seizeAmount та seizedValue вже встановлені як full seizure за замовчуванням)
        liquidationData.currentHF = 0;
    }
} else {
    // LP × targetHF ≤ CF: вилучення цього активу погіршує HF
    // Все одно вилучаємо повністю для максимального погашення боргу
    liquidationData.currentHF = 0;
}
```

### Спрощена логіка після рефакторингу

Вся гілкова логіка з `expectedHF`, `calculation` (рядки 1144–1156) видаляється й замінюється єдиним потоком:

```
для кожного активу j:
    debtRemaining = uint256(-debt) - deltaValue

    якщо LP_j × targetHF > CF_j:                           // знаменник > 0
        Δ_j = (targetHF × debtRemaining − totalCV_CF) × FACTOR_SCALE / (LP_j × targetHF − CF_j)

        якщо Δ_j ≤ balance_j × price_j:
            → часткове вилучення Δ_j, break                // targetHF досягнуто
        інакше:
            → повне вилучення активу j, continue            // до наступного активу
    інакше:
        → повне вилучення (LP × targetHF ≤ CF: цей актив не покращує HF)
        continue

    якщо всі активи вичерпано без досягнення targetHF:
        → повна ліквідація завершена (currentHF = 0)
```

---

## Fix 4 — Додати перевірку `baseBorrowMin` (RFC Post 1, Post 9)

### Проблема

RFC явно вимагає: якщо після часткового вилучення залишок боргу < `baseBorrowMin`, переходити до повної ліквідації. Поточний контракт цієї перевірки не реалізує.

### Де додати

Перед виконанням часткового вилучення (після розрахунку `rawCollateralUSD`):

```solidity
uint256 debtAfterPartial = debtRemaining - mulFactor(rawCollateralUSD, assetInfo.liquidationFactor);
uint256 baseDebtAfterPartial = divPrice(debtAfterPartial, basePrice, uint64(baseScale));

if (baseDebtAfterPartial < baseBorrowMin) {
    // Залишок — пилова позиція: переходимо до повної ліквідації
    // Не встановлюємо currentHF = targetHF, виходимо з partial-шляху
    liquidationData.currentHF = 0;
    // seizeAmount та seizedValue залишаються = full seizure (встановлені за замовчуванням)
} else {
    // Часткове вилучення
    ...
}
```

---

## Fix 5 — Виправити та розширити тести (Bug 8)

### Проблема

Чотири failing тести очікують `finalIsLiquidatable = true`. RFC (victator, Post 8) фіксує:
> "The isLiquidatable function can remain unchanged."

Після досягнення `targetHF > 1.0` акаунт завжди виходить із зони ліквідації (`isLiquidatable = false`). Тестові очікування помилкові.

### Зміни у тестах

```typescript
// БУЛО (неправильно):
expect(finalIsLiquidatable).to.be.true;

// СТАЛО (правильно):
expect(finalIsLiquidatable).to.be.false;
```

### Додаткові assertions для перевірки формули (критично важливо)

Поточні тести не перевіряють точність формули — необхідно додати:

```typescript
// 1. Перевірити, що залишилося забезпечення (часткова, а не повна ліквідація)
const remainingBalance = (await comet.userCollateral(account.address, collateralAsset.address)).balance;
expect(remainingBalance).to.be.gt(0n, "Should be partial, not full liquidation");

// 2. Перевірити точний залишок боргу (правильність формули)
const expectedDebtReduction = rawCollateralUSD * liquidationFactor / FACTOR_SCALE;
const expectedNewDebt = initialDebt - expectedDebtReduction;
const actualBalance = await comet.borrowBalanceOf(account.address);
expect(actualBalance).to.approximately(expectedNewDebt / basePrice, tolerance);

// 3. Перевірити HF після absorb ≈ targetHF
const remainingCollateralValue = remainingBalance * price * borrowCF / scale / FACTOR_SCALE;
const actualHF = remainingCollateralValue * FACTOR_SCALE / expectedNewDebt;
expect(actualHF).to.approximately(targetHF, 1e12); // ±1e12 для rounding

// 4. Перевірити, що account не є ліквідованим (передбачувано)
expect(finalIsLiquidatable).to.be.false;
```

### Нові тест-кейси, яких не вистачає

| Тест | Мета |
|---|---|
| Single collateral, правильні параметри (`LP × THF > CF`) | Перевірити точний `seizeAmount` та `seizedValue` за формулою |
| Multi-collateral: перший актив вилучається повністю, другий частково | Перевірити `deltaValue` у змішаному сценарії |
| `LP × targetHF < CF` — очікувати повну ліквідацію (не revert) | Перевірити fallback-поведінку |
| `LP × targetHF = CF` — очікувати revert або коректну обробку | Issue E (div by zero) |
| Залишок боргу < `baseBorrowMin` — перейти до повної ліквідації | Fix 4 |
| Другий absorb після першого (ціна падає ще) | Послідовні часткові ліквідації |

---

## Fix 6 — Валідація конфігурації `targetHF` у Configurator (RFC constraint)

### Проблема

Умова `LP × targetHF > CF` (відповідно `targetHF > CF/LP`) — необхідна для роботи формули. При її порушенні або знаменник від'ємний (underflow Solidity 0.8 → revert) або ділення на нуль. Жодної валідації немає.

### Де додати

У `ConfiguratorPartialLiquidation`, сеттер `targetHealthFactor`:

```solidity
function setTargetHealthFactor(address comet, uint64 newTargetHF) external {
    require(newTargetHF > FACTOR_SCALE, "targetHF must be > 1.0");

    uint8 numAssets = CometInterface(comet).numAssets();
    for (uint8 i = 0; i < numAssets; i++) {
        CometInterface.AssetInfo memory asset = CometInterface(comet).getAssetInfo(i);
        uint256 denom = mulFactor(asset.liquidationFactor, newTargetHF);
        require(
            denom > asset.borrowCollateralFactor,
            "targetHF too low: LP * targetHF must exceed borrowCF for all assets"
        );
    }
    // ... встановлення значення
}
```

Також захисний guard у `absorbInternal` (runtime):

```solidity
uint256 denom = mulFactor(assetInfo.liquidationFactor, targetHF);
if (denom <= assetInfo.borrowCollateralFactor) {
    // Цей актив не може покращити HF при даному targetHF → повне вилучення
    liquidationData.currentHF = 0;
    // fallthrough до deltaValue += seizedValue (full)
} else {
    // Часткове вилучення...
}
```

---

## Fix 7 — Захист від div/0 у `expectedHF` (якщо не застосовується Fix 3)

### Проблема (рядок 1149)

```solidity
liquidationData.expectedHF = (...) / (uint256(-debt) - deltaValue - liquidationData.seizedValue);
```

Якщо `seizedValue` поточного активу точно дорівнює залишку боргу → div/0 → Solidity 0.8 panic → revert.

### Виправлення (тимчасове, до застосування Fix 3)

```solidity
uint256 denomExpected = uint256(-debt) - deltaValue - liquidationData.seizedValue;
if (denomExpected == 0) {
    // Поточний актив покриває весь борг → повна ліквідація, target досягнуто
    liquidationData.expectedHF = targetHF;
} else {
    liquidationData.expectedHF =
        (liquidationData.totalCollaterizedValue - liquidationData.collaterizationValue)
        * FACTOR_SCALE / denomExpected;
}
```

**Примітка**: Fix 3 (рефакторинг логіки) усуває цей рядок повністю, тому Fix 7 є лише тимчасовим патчем.

---

## Fix 8 — Прибрати `console.log` перед деплоєм / аудитом

Контракт містить ~25 викликів `console.log` / `console.logInt` (рядки 1115–1209) та `import "hardhat/console.sol"` у рядку 12.

```solidity
// Видалити:
import "hardhat/console.sol";

// Видалити всі:
console.log(...);
console.logInt(...);
```

---

## Порядок реалізації

| Крок | Fixes | Обґрунтування |
|---|---|---|
| 1 | Fix 6 | Зафіксувати constraint `LP × targetHF > CF` у Configurator до будь-якого тестування |
| 2 | Fix 1 + Fix 2 + Fix 3 | Єдиний рефакторинг: формула, семантика, guard — щільно пов'язані |
| 3 | Fix 4 | `baseBorrowMin` — окрема перевірка, додається після основної логіки |
| 4 | Fix 5 | Оновлення тестів після виправлення формул |
| 5 | Fix 7 | Лише якщо Fix 3 не застосовується повністю |
| 6 | Fix 8 | Фінальний cleanup |

---

## Апендикс: швидкий reference формули

```
Дано:
  D   = uint256(-debt) - deltaValue              залишок боргу (USD price-scale)
  TCV = totalCollaterizedValue                    Σ(balance_i × price_i × borrowCF_i), залишок
  LP  = assetInfo.liquidationFactor              для поточного активу
  CF  = assetInfo.borrowCollateralFactor         для поточного активу
  THF = targetHF (наприклад 1.05 × 1e18)

Умова валідності:
  LP × THF > CF   (тобто THF > CF / LP)

Raw USD для вилучення:
  Δ = (THF × D − TCV) × FACTOR_SCALE / (LP × THF − CF)

Токени для вилучення:
  seizeAmount = Δ / price

Погашення боргу (додається до deltaValue):
  seizedValue = Δ × LP

Перевірка (після вилучення):
  New TCV = TCV − Δ × CF
  New D   = D   − Δ × LP
  HF_new  = New TCV / New D = THF ✓
```
