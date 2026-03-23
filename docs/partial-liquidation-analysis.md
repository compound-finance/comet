# Partial Liquidation — Formula Analysis: RFC vs Contract Implementation

---

## 1. Термінологія та маппінг між RFC і контрактом

RFC на comp.xyz використовує одну термінологію, контракт — іншу. Перед аналізом необхідно чітко зафіксувати відповідність:

| RFC / форум | Контракт (`assetInfo`) | Роль |
|---|---|---|
| `collateral_factor` (CF) | `borrowCollateralFactor` | Максимальна кредитна ємність: `max_debt = Σ(balance × price × CF)` |
| `collateral_liquidation_factor` | `liquidateCollateralFactor` | Поріг ліквідації: `isLiquidatable` = true коли `debt > Σ(balance × price × liquidateCF)` |
| `liquidation_penalty` (LP) | `liquidationFactor` | Знижка при ліквідації: seizure of `Δ` raw USD repays `Δ × LP` of debt |

Три фактори — різні числа. У стандартних конфігураціях: `borrowCF < liquidateCF < 1`, а `liquidationFactor ≤ 1`.

---

## 2. Визначення Health Factor у RFC vs у контракті

### RFC (LTV-space, formula 1)
```
HF_rfc = debt / Σ(balance_i × price_i × CF_i)
```
- `HF_rfc < 1` → акаунт здоровий (борг менший за CF-зважене забезпечення)
- `HF_rfc = LHF` → поріг ліквідації (де `LHF = liquidateCF-weighted / CF-weighted`)
- Типово `LHF > 1`, наприклад: `LHF = 0.85 / 0.80 = 1.0625`
- **`target_HF_rfc = x% × LHF`** (RFC рекомендує `x ≈ 98%`, post 8: victator)

### Контракт (value-coverage space — інверсне)
```
HF_code = Σ(balance_i × price_i × CF_i) / debt = totalCollaterizedValue / debt
```
- `HF_code > 1` → здоровий
- `HF_code < 1` → недоколатеризований (але ліквідація через `liquidateCF`, не `CF`)
- `targetHF` в коді = `1.05 × 1e18`

### Зв'язок між двома конвенціями
```
HF_code = 1 / HF_rfc
```

RFC formula 12 записана в LTV-space. Для імплементації в коді потрібно перевести в value-coverage space (інвертувати обидві сторони рівняння).

---

## 3. Фінальна формула RFC (formula 13) та її коректна адаптація

### RFC formula 12 (вихідне рівняння для одного активу)

З RFC post 1 (woof):
```
target_HF_rfc = [debt − Δ × LP] / [(collateral_value − Δ) × CF]
```
де:
- `Δ` — raw USD вартість забезпечення, яке вилучається
- `Δ × LP` — сума боргу, яка списується (formula 10)
- `(collateral_value − Δ) × CF` — CF-зважений залишок забезпечення
- `collateral_value` = raw USD поточного активу (single-asset case = `totalCollaterizedValue / CF`)

### RFC formula 13 (розв'язок відносно Δ, LTV-space)

RFC Post 1, повна деривація:
```
target_HF_rfc × (collateral_value − Δ) × CF = debt − Δ × LP
target_HF_rfc × CF × collateral_value − target_HF_rfc × CF × Δ = debt − LP × Δ
LP × Δ − target_HF_rfc × CF × Δ = debt − target_HF_rfc × CF × collateral_value

Δ = [debt − collateral_value × CF × target_HF_rfc] / [LP − CF × target_HF_rfc]
```

### Адаптація до code-convention (value-coverage space)

Перетворення `target_HF_rfc` → `targetHF_code` (`targetHF_code = 1 / target_HF_rfc`), а сам рівноваги переписуємо з оберненою нерівністю:

```
targetHF_code = [(collateral_value − Δ) × CF] / [debt − Δ × LP]
```

Розв'язок:
```
targetHF_code × (debt − Δ × LP) = (collateral_value − Δ) × CF
targetHF_code × debt − targetHF_code × LP × Δ = CF × collateral_value − CF × Δ
CF × Δ − targetHF_code × LP × Δ = CF × collateral_value − targetHF_code × debt
Δ × (CF − LP × targetHF_code) = CF × collateral_value − targetHF_code × debt
```

Оскільки `LP × targetHF_code > CF` (умова валідної конфігурації), ділимо на від'ємне:

```
Δ_raw_USD = (targetHF_code × debt_remaining − totalCV_CF_remaining) / (LP × targetHF_code − CF)
```

де `totalCV_CF_remaining = CF × collateral_value = totalCollaterizedValue` (CF-зважений залишок усіх активів).

### Мультиколатеральне розширення (RFC formula 14)

RFC Post 1 описує ітерацію: якщо Δ перевищує наявний баланс активу `j-1` → вилучаємо його повністю, оновлюємо `debt_remaining` і `totalCV_CF_remaining`, переходимо до активу `j`:

```
Δ_j = (targetHF_code × debt_remaining − totalCV_CF_remaining) / (LP_j × targetHF_code − CF_j)
```

де після кожного попереднього повного вилучення:
- `debt_remaining` -= `Δ_(j−1)_raw_USD × LP_(j−1)`
- `totalCV_CF_remaining` -= `balance_(j−1) × price_(j−1) × CF_(j−1)`

### Маппінг формули на змінні контракту

| Символ формули | Змінна контракту |
|---|---|
| `Δ_raw_USD` | (не існує окремо — потрібно ввести) |
| `debt_remaining` | `uint256(-debt) - deltaValue` |
| `totalCV_CF_remaining` | `totalCollaterizedValue` |
| `LP` | `assetInfo.liquidationFactor` |
| `CF` | `assetInfo.borrowCollateralFactor` |
| `targetHF_code` | `targetHF` (з `IHealthFactorHolder`) |

Правильний код для часткового вилучення:
```solidity
uint256 debtRemaining = uint256(-debt) - deltaValue;
uint256 rawCollateralUSD = (mulFactor(debtRemaining, targetHF) - liquidationData.totalCollaterizedValue)
    * FACTOR_SCALE
    / (mulFactor(assetInfo.liquidationFactor, targetHF) - assetInfo.borrowCollateralFactor);

// Кількість токенів
liquidationData.seizeAmount = divPrice(rawCollateralUSD, getPrice(assetInfo.priceFeed), assetInfo.scale);
// Погашення боргу (= Δ × LP, аналогічно full seizure path)
liquidationData.seizedValue = mulFactor(rawCollateralUSD, assetInfo.liquidationFactor);
```

---

## 4. Що реально робить поточний код (line 1174)

```solidity
// Line 1171
uint256 requiredCollateralValue = mulFactor(uint256(-debt) - deltaValue, targetHF);
// = debt_remaining × targetHF

// Line 1172 — guard
if (liquidationData.totalCollaterizedValue2 >= requiredCollateralValue) {

    // Line 1174 — ПОТОЧНА ФОРМУЛА
    liquidationData.seizedValue = (liquidationData.totalCollaterizedValue2 - requiredCollateralValue)
        * FACTOR_SCALE
        / (mulFactor(assetInfo.liquidationFactor, targetHF) - assetInfo.borrowCollateralFactor);

    // Line 1175
    liquidationData.seizeAmount = divPrice(liquidationData.seizedValue, getPrice(...), assetInfo.scale);
    liquidationData.currentHF = targetHF;
}
```

Поточна формула: `(totalCollaterizedValue2 − debt × targetHF) / (LP × targetHF − CF)`

Правильна формула: `(targetHF × debt − totalCollaterizedValue) / (LP × targetHF − CF)`

---

## 5. Відхилення від RFC: повний перелік

### Bug 1 — Неправильна змінна: `totalCollaterizedValue2` замість `totalCollaterizedValue`

| | RFC formula 13 | Поточний код |
|---|---|---|
| Чисельник (1-й доданок) | `totalCV_CF = Σ(balance × price × **borrowCF**)` | `totalCV_LF = Σ(balance × price × **liquidationFactor**)` |
| Код | `liquidationData.totalCollaterizedValue` | `liquidationData.totalCollaterizedValue2` |

Контракт використовує `totalCollaterizedValue2` — LF-зважений агрегат — там, де формула вимагає CF-зважений `totalCollaterizedValue`.

---

### Bug 2 — Інвертований знак чисельника

| | Формула |
|---|---|
| Правильно (з RFC) | `(targetHF × debt_remaining − totalCV_CF)` |
| Поточний код | `(totalCollaterizedValue2 − debt_remaining × targetHF)` |

Два помилкові знаки: інверсія порядку операндів і різні змінні. Поточний код отримує додатний результат тільки коли `totalCV_LF > debt × targetHF`, що є зворотною умовою від тієї, яка потрібна.

**Комент у коді (line 1160–1162) показує правильну деривацію, але реалізація їй суперечить:**
```
/// target HF = (collateral value - delta * CF) / (debt - delta * LF)
/// =>
/// delta = (collateral value - debt * THF) / (LF * THF - CF)
```
Навіть комент має помилку у знаку: `(collateral value − debt × THF)` замість правильного `(THF × debt − collateral value)`.

---

### Bug 3 — Неправильна семантика `seizedValue` у partial-шляху

У повному вилученні:
```solidity
seizedValue = mulFactor(collateralValue, liquidationFactor)   // = rawUSD × LP
```
`seizedValue` = зменшення боргу (завжди ≤ raw USD вартості колатералю).

У поточному частковому вилученні:
```solidity
seizedValue = formula_result   // трактується як raw USD (Δ)
seizeAmount = seizedValue / price  // → seizeAmount = rawUSD / price ✓ (зберігається)
deltaValue += seizedValue      // += rawUSD, а не rawUSD × LP!
```

`deltaValue` = сума погашеного боргу. Він має накопичувати `Δ × LP` від кожного активу (повного або часткового), а не raw USD. У поточному partial-шляху борг завищується в `1/LP` разів.

Правильно для partial:
```solidity
liquidationData.seizeAmount  = divPrice(rawCollateralUSD, price, scale);   // rawUSD / price
liquidationData.seizedValue  = mulFactor(rawCollateralUSD, liquidationFactor); // rawUSD × LP
deltaValue += liquidationData.seizedValue;  // += Δ × LP ✓
```

---

### Bug 4 — Guard-умова відсіює легітимні позиції

Поточний guard (line 1172):
```solidity
if (liquidationData.totalCollaterizedValue2 >= requiredCollateralValue)
// тобто: LF-weighted-collateral >= debt × targetHF
```

Ця умова НІКОЛИ не спрацьовує для активів з `LF < liquidateCF`, бо:
```
totalCV_LF = Σ(balance × price × LF) < Σ(balance × price × liquidateCF) < debt (ліквідований)
           < debt × targetHF
```

Правильна умова — перевірка, що знаменник додатний і наявного балансу достатньо:
```
LP × targetHF > CF          (denominator > 0: можна покращити HF вилученням цього активу)
rawCollateralUSD ≤ balance × price   (достатньо балансу для часткового вилучення)
```

Для ліквідованого акаунту чисельник `(targetHF × debt − totalCV_CF)` завжди додатний (бо `HF_code < 1 < targetHF`), тому guard зводиться лише до перевірки знаменника та наявного балансу.

---

### Bug 5 — `seizeAmount` після partial path не враховує LP при зворотному відліку `deltaValue`

У partial-шляху (рядок 1175):
```solidity
liquidationData.seizeAmount = divPrice(liquidationData.seizedValue, getPrice(...), assetInfo.scale);
```

Якщо `seizedValue = raw_USD` (Bug 3), то `seizeAmount = raw_USD / price` — кількість токенів правильна.
Але якщо `seizedValue` виправити на `raw_USD × LP`, то:
```solidity
seizeAmount = divPrice(seizedValue, price, scale);   // = (rawUSD × LP) / price ← НЕВІРНО
```
Токенів буде вилучено в `LP` разів менше, ніж потрібно.
**Виправлення**: рахувати `seizeAmount` від `rawCollateralUSD`, а не від `seizedValue`.

---

## 6. Числова перевірка: passing test case

### Вхідні дані
```
100,000 COMP, ціна $0.94
debt = $80,000
borrowCF = 0.8, liquidateCollateralFactor = 0.85, liquidationFactor = 0.9
targetHF = 1.05
```

### Правильний результат (RFC formula 13, code-convention)

```
totalCV_CF = 100,000 × $0.94 × 0.8 = $75,200

Δ_raw_USD = (1.05 × $80,000 − $75,200) / (0.9 × 1.05 − 0.8)
           = ($84,000 − $75,200) / (0.945 − 0.8)
           = $8,800 / 0.145
           = $60,690

seizeAmount  = $60,690 / $0.94 = 64,564 COMP
seizedValue  = $60,690 × 0.9  = $54,621  (борг, що списується)
```

Перевірка:
```
New CF-collateral = (100,000 − 64,564) × $0.94 × 0.8 = 35,436 × $0.752 = $26,648
New debt         = $80,000 − $54,621 = $25,379
New HF_code      = $26,648 / $25,379 = 1.050 ✓
```

### Що рахує поточний код

```
totalCV_LF  = 100,000 × $0.94 × 0.9 = $84,600
required    = $80,000 × 1.05         = $84,000
Guard: $84,600 ≥ $84,000 → fires ✓ (лише через вузький збіг параметрів)

seizedValue (код) = ($84,600 − $84,000) / (0.945 − 0.8) = $600 / 0.145 = $4,138
seizeAmount       = $4,138 / $0.94 = 4,402 COMP
deltaValue        += $4,138  (без LP!)
```

Відхилення від правильного результату:
```
seizeAmount: 4,402 COMP замість 64,564 COMP  → похибка 93.2%
seizedValue: $4,138 замість $54,621          → похибка 92.4%
```

Реальний стан акаунту після поточного коду:
```
Залишок COMP: 95,598 × $0.94 = $89,862 raw
CF-collateral: $89,862 × 0.8 = $71,890
"Залишковий борг" (deltaValue): $80,000 − $4,138 = $75,862
Реальний HF_code = $71,890 / $75,862 = 0.948 ← НИЖЧЕ target 1.05!
```

Код встановлює `currentHF = targetHF` (рядок 1176) хоча реальний HF = 0.948. Тест проходить тільки тому, що `isLiquidatable` (яка використовує `liquidateCollateralFactor = 0.85`, більш ліберальний фактор) повертає `false`:
```
liquidateCF-weighted: 95,598 × $0.94 × 0.85 = $76,366 > $75,862 → not liquidatable
```
Тест перевіряє тільки `isLiquidatable`, а не фактичний HF → **формула хибна, але тест не виявляє цього**.

---

## 7. Числова перевірка: failing test cases

### Параметри (COMP + WETH, multiple collateral)
```
COMP: LF = 0.7, borrowCF = 0.8, liquidateCF = 0.85
WETH: LF = 0.65, borrowCF = 0.75, liquidateCF = 0.80
targetHF = 1.05
```

### Чому guard ніколи не спрацьовує

Для ліквідованого акаунту: `debt > Σ(balance × price × liquidateCF)`

Оскільки `LF < liquidateCF` для цих активів:
```
totalCV_LF = Σ(balance × price × LF) < Σ(balance × price × liquidateCF) < debt
           ∴ totalCV_LF < debt < debt × 1.05 = requiredCollateralValue
```
Guard `totalCollaterizedValue2 >= requiredCollateralValue` → НІКОЛИ false → завжди fallback (повне вилучення).

### Правильний алгоритм для цих параметрів

Перевіримо знаменник для COMP:
```
LP × targetHF − CF = 0.7 × 1.05 − 0.8 = 0.735 − 0.8 = −0.065 < 0
```
Знаменник від'ємний → `rawCollateralUSD = (positive) / (negative) < 0` → вилучення COMP не покращує HF.

Для WETH:
```
LP × targetHF − CF = 0.65 × 1.05 − 0.75 = 0.6825 − 0.75 = −0.0675 < 0
```
Знаменник теж від'ємний → жоден актив не може покращити HF за формулою.

**Висновок**: при таких параметрах часткова ліквідація математично неможлива — вилучення будь-якого активу погіршує HF (кожна одиниця сейзд знімає більше від CF-зваженого колатералю, ніж від боргу через LP < CF). Єдиний варіант — повна ліквідація.

Це означає, що `targetHF = 1.05` не відповідає цим параметрам активів. RFC constraint: `targetHF < LP / CF` для кожного активу:
- COMP: `targetHF < 0.7/0.8 = 0.875` — нижче 1.0!
- WETH: `targetHF < 0.65/0.75 = 0.867` — нижче 1.0!

Частковa ліквідація з targetHF > 1.0 неможлива для активів, де `LF < CF`.

---

## 8. Аналіз guard-умови та `expectedHF` логіки

### Поточна багатогілкова логіка (lines 1144–1156)

```solidity
if (totalCV == collaterizationValue && totalCV2 > remaining_debt) {
    calculation = true;                     // Гілка A: останній актив, LF > debt
} else if (totalCV > collaterizationValue) {
    expectedHF = (totalCV − collCV) / (debt − seizedValue);  // Гілка B: є ще активи
} else if (totalCV > remaining_debt) {
    calculation = true;                     // Гілка C: CF-value перевищує борг
} else {
    expectedHF = 0;                         // Гілка D: повна ліквідація
}
```

#### Проблема гілки B

`expectedHF = (totalCV − collCV) * FACTOR_SCALE / (debt − seizedValue)`

- Чисельник: `totalCollaterizedValue − collaterizationValue` = CF-зважений залишок після поточного активу
- Знаменник: `debt − seizedValue` = борг мінус LF-adjusted value поточного активу

Це **не є** стандартним HF. Правильний `expectedHF` якби ми вилучили весь поточний актив:
```
HF_after_full_j = (totalCV_CF − collCV_j) / (debt_remaining − seizedValue_j × LP_j / LP_j)
                = (totalCV_CF − collCV_j) / (debt_remaining − collateralValue_j × LP_j)
```
Де `seizedValue_j = collateralValue_j × LP_j` (правильна семантика повного вилучення). У поточному коді `seizedValue = collateralValue × LF` (що правильно для full-шляху), але знаменник формулює `(debt − seizedValue)` де `debt = uint256(-debt) - deltaValue` (initial debt - accumulated reduction). Логічно, але `expectedHF` рахується некоректно — він не є формальним HF у жодній з конвенцій.

#### Гілка A vs C: перевірка `totalCV2` замість `totalCV`

Гілка A перевіряє `totalCollaterizedValue2 > remaining_debt` (LF-weighted), хоча для HF розрахунку потрібно CF-weighted. Гілка C перевіряє `totalCollaterizedValue > remaining_debt` (CF-weighted) — більш правильно, але порівнює різні величини (CF-collateral проти raw debt).

RFC не передбачає таку логіку — формула (13) сама визначає кількість вилучення, і якщо `Δ ≤ balance × price` — часткове, якщо `Δ > balance × price` — повне.

---

## 9. Вимога RFC щодо `baseBorrowMin` (Post 1, Post 9)

RFC (Post 1, Post 9) чітко фіксує: **перед частковою ліквідацією перевіряти `baseBorrowMin`**:

> "Enforce minimum debt check (baseBorrowMin) — full liquidation triggered if 'dust position' remains"

Поточний контракт не реалізує цю перевірку. Якщо після часткового вилучення залишок боргу < `baseBorrowMin`, необхідно перейти до повної ліквідації, щоб не залишати пилові позиції.

---

## 10. Рішення RFC щодо метрики `isLiquidatable` після absorb (Post 9)

RFC (victator, Post 8) прямо зазначає:
> "The isLiquidatable function can remain unchanged."

Тобто RFC не вимагає, щоб акаунт залишався ліквідованим після часткової ліквідації. Ціль — довести акаунт до `targetHF`, після чого він виходить із ліквідованої зони. Чотири failing тести з очікуванням `finalIsLiquidatable = true` **суперечать фінальному рішенню RFC**.

---

## 11. Умова валідності конфігурації (RFC constraint)

З formula 13: знаменник `LP − CF × target_HF_rfc` (LTV-space) = `LP × targetHF_code − CF` (code-space).

Умова `LP × targetHF_code > CF` ↔ `targetHF_code > CF / LP`:

| Актив | LP (`liquidationFactor`) | CF (`borrowCF`) | `CF/LP` | targetHF = 1.05 | Валідно? |
|---|---|---|---|---|---|
| COMP (test pass) | 0.90 | 0.80 | 0.889 | 1.05 > 0.889 | ✓ |
| COMP (test fail) | 0.70 | 0.80 | 1.143 | 1.05 < 1.143 | ✗ |
| WETH (test fail) | 0.65 | 0.75 | 1.154 | 1.05 < 1.154 | ✗ |

Для активів з `LF < CF` часткова ліквідація математично неможлива при будь-якому `targetHF > 1`. Такі активи завжди потребують повного вилучення.

RFC не встановлює цього constraint явно у формулах, але він виходить безпосередньо з алгебри formula 13. Конфігуратор має перевіряти `LP × targetHF > CF` для кожного активу.

---

## 12. Зведена таблиця відхилень

| # | Аспект | RFC / Правильно | Поточний код | Рядок |
|---|---|---|---|---|
| 1 | Змінна в чисельнику | `totalCollaterizedValue` (CF-зважений) | `totalCollaterizedValue2` (LF-зважений) | 1174 |
| 2 | Знак чисельника | `targetHF × debt − totalCV_CF` | `totalCV2 − debt × targetHF` (інверсія) | 1174 |
| 3 | Семантика `seizedValue` | `Δ × LP` (debt reduction) | `Δ` raw USD (без LP) | 1174, 1194 |
| 4 | `seizeAmount` від `seizedValue` | `seizeAmount = rawCollateralUSD / price` | `seizeAmount = seizedValue / price` (буде невірно після Bug 3 fix) | 1175 |
| 5 | Guard-умова | перевірка знаменника + балансу | `totalCV2 >= debt × targetHF` | 1172 |
| 6 | `baseBorrowMin` перевірка | обов'язкова (RFC Post 1, 9) | відсутня | — |
| 7 | Комент деривації | правильний у знаменнику, хибний у чисельнику | `(CV − debt×THF)` замість `(THF×debt − CV)` | 1162 |
| 8 | Тести `finalIsLiquidatable = true` | має бути `false` (RFC Post 8) | очікується `true` | test files |

---

## 13. Статус тестового набору

| Результат | Кількість | Причина |
|---|---|---|
| Passing | 10 | Тести перевіряють лише `isLiquidatable`, яка використовує більш ліберальний `liquidateCF`. Навіть неправильна формула (вилучає ~7% потрібного) достатньо зменшує борг, щоб вийти з ліквідованої зони по `liquidateCF`. |
| Failing | 4 | Guard `totalCV2 >= debt × targetHF` ніколи не спрацьовує при `LF < liquidateCF` → завжди повна ліквідація → `isLiquidatable = false` ≠ `true` |

**Критичний висновок**: passing тести не підтверджують правильність формули — вони перевіряють занадто слабку умову (`isLiquidatable = false`). Необхідні тести, які перевіряють точний залишок боргу та колатералю після absorb.
