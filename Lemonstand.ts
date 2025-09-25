// Lemonade Stand Simulation (TypeScript, single-file)
// Inspired by "Lemonade Stand" (Apple II, 1979). This version focuses on
// clean OOP design you can extend for UI or different strategies.

/*********************
 * Domain Primitives *
 *********************/

enum WeatherKind {
  Cold = "Cold",
  Mild = "Mild",
  Hot = "Hot",
  Storm = "Storm",
}

class Weather {
  readonly kind: WeatherKind;
  readonly tempF: number;

  constructor(kind: WeatherKind, tempF: number) {
    this.kind = kind;
    this.tempF = tempF;
  }

  /** Demand multiplier driven by weather conditions. */
  demandBoost(): number {
    switch (this.kind) {
      case WeatherKind.Hot: return 1.4;
      case WeatherKind.Mild: return 1.0;
      case WeatherKind.Cold: return 0.6;
      case WeatherKind.Storm: return 0.25;
    }
  }

  /** Simple textual forecast like the original game provided. */
  forecast(): string {
    switch (this.kind) {
      case WeatherKind.Hot: return "Sunny and hot";
      case WeatherKind.Mild: return "Warm and pleasant";
      case WeatherKind.Cold: return "Chilly";
      case WeatherKind.Storm: return "Thunderstorms likely";
    }
  }
}

/** Ingredient book-keeping */
class Inventory {
  private _lemons = 0;     // whole lemons
  private _sugar = 0;      // cups of sugar
  private _ice = 0;        // ice cubes
  private _cups = 0;       // paper cups

  // Pitcher state (derived resource)
  private cupsLeftInPitcher = 0;

  get lemons() { return this._lemons; }
  get sugar() { return this._sugar; }
  get ice() { return this._ice; }
  get cups() { return this._cups; }
  get pitcherCupsRemaining() { return this.cupsLeftInPitcher; }

  add(lemons = 0, sugar = 0, ice = 0, cups = 0): void {
    this._lemons += lemons;
    this._sugar += sugar;
    this._ice += ice;
    this._cups += cups;
  }

  /** Ice melts overnight in classic lemonade games. */
  meltIce(percentLost = 1.0) {
    // By default, lose all ice overnight.
    this._ice = Math.max(0, Math.floor(this._ice * (1 - percentLost)));
  }

  /** Attempt to brew a pitcher given the recipe. Returns true if brewed. */
  tryBrewPitcher(recipe: Recipe): boolean {
    if (this._lemons >= recipe.lemonsPerPitcher && this._sugar >= recipe.sugarCupsPerPitcher) {
      this._lemons -= recipe.lemonsPerPitcher;
      this._sugar -= recipe.sugarCupsPerPitcher;
      this.cupsLeftInPitcher = recipe.cupsPerPitcher;
      return true;
    }
    return false;
  }

  /**
   * Consume ingredients to pour exactly one cup, brewing new pitchers on demand.
   * Returns true if a cup was successfully poured.
   */
  pourCup(recipe: Recipe): boolean {
    if (this._cups <= 0 || this._ice < recipe.iceCubesPerCup) return false;

    if (this.cupsLeftInPitcher <= 0) {
      if (!this.tryBrewPitcher(recipe)) return false; // can't brew
    }

    // Serve one cup
    this._cups -= 1;
    this._ice -= recipe.iceCubesPerCup;
    this.cupsLeftInPitcher -= 1;
    return true;
  }
}

class Recipe {
  constructor(
    public lemonsPerPitcher: number = 6,
    public sugarCupsPerPitcher: number = 4,
    public iceCubesPerCup: number = 4,
    public cupsPerPitcher: number = 12,
  ) {}
}

/*************************
 * Economy & Transactions *
 *************************/

/** Stochastic supply prices like the original game. */
class PriceList {
  readonly lemonPrice: number; // per lemon
  readonly sugarPrice: number; // per cup sugar
  readonly icePrice: number;   // per cube
  readonly cupPrice: number;   // per paper cup

  constructor(
    lemonPrice: number,
    sugarPrice: number,
    icePrice: number,
    cupPrice: number,
  ) {
    this.lemonPrice = lemonPrice;
    this.sugarPrice = sugarPrice;
    this.icePrice = icePrice;
    this.cupPrice = cupPrice;
  }

  static random(dayIndex: number, rng: RNG): PriceList {
    // Baseline prices reminiscent of the 1979 game, with small daily variance.
    const vary = (base: number, spreadPct: number) => +(base * (1 + rng.uniform(-spreadPct, spreadPct))).toFixed(3);
    return new PriceList(
      vary(0.05, 0.25), // lemons
      vary(0.07, 0.25), // sugar (per cup)
      vary(0.01, 0.30), // ice (per cube)
      vary(0.02, 0.25), // cups
    );
  }
}

/** Record of purchases for a day. */
interface PurchaseOrder {
  lemons: number;
  sugarCups: number;
  iceCubes: number;
  cups: number;
}

/** Outcome of a single simulated sales day. */
interface DayResult {
  day: number;
  weather: Weather;
  prices: PriceList;
  plan: DayPlan;
  customers: number;
  cupsSold: number;
  grossRevenue: number;
  supplyCost: number;
  netProfit: number;
  leftover: { lemons: number; sugar: number; ice: number; cups: number; };
}

/********************
 * Stand & Strategy  *
 ********************/

/** How the player chooses price, purchases, and recipe changes each day. */
interface DayPlan {
  setPricePerCup: number;
  order: PurchaseOrder;
  recipe: Recipe; // may adjust day-to-day
}

interface Strategy {
  planDay(context: Readonly<StandState>, weatherForecast: Weather, prices: PriceList, dayIndex: number): DayPlan;
}

class StandState {
  readonly inventory: Inventory;
  recipe: Recipe;
  pricePerCup: number;
  cash: number;
  private _history: DayResult[] = [];

  constructor(cash: number, recipe = new Recipe(), pricePerCup = 0.25) {
    this.cash = cash;
    this.recipe = recipe;
    this.pricePerCup = pricePerCup;
    this.inventory = new Inventory();
  }

  get history(): ReadonlyArray<DayResult> { return this._history; }
  pushHistory(r: DayResult) { this._history.push(r); }
}

/**
 * Demand model approximating the classic game's behavior:
 * - More customers when it's hot, fewer when it's cold or storming.
 * - Price elasticity: higher prices reduce purchase probability.
 */
class Market {
  constructor(private rng: RNG) {}

  /** Sample customer count from weather + small randomness */
  customerTraffic(weather: Weather): number {
    const base = 60; // baseline foot traffic
    const multiplier = weather.demandBoost();
    const noise = this.rng.normal(0, 8); // day-to-day noise
    return Math.max(0, Math.round(base * multiplier + noise));
  }

  /**
   * Probability a customer buys at the offered price.
   * Calibration: ~90% buy at $0.10 on a hot day, ~20% at $1.00.
   */
  buyProbability(price: number, weather: Weather): number {
    const w = weather.demandBoost(); // 0.25 .. 1.4
    // A simple logistic-like curve using price and weather.
    const priceRef = 0.25; // “sweet spot” reference
    const elasticity = 3.0; // higher -> more sensitive
    const x = (price / priceRef) - 1; // 0 at sweet spot
    let p = 1 / (1 + Math.exp(elasticity * x)); // 0..1
    // Weather increases buying inclination multiplicatively, but cap to [0,1].
    p = Math.min(1, p * (0.65 + 0.35 * w));
    // Clamp
    return Math.max(0, Math.min(1, p));
  }
}

/*****************
 * Random Helper *
 *****************/

class RNG {
  private seed: number;
  constructor(seed = 123456789) { this.seed = seed >>> 0; }
  // xorshift32
  private nextUint(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0; return this.seed;
  }
  uniform(min = 0, max = 1): number { return min + (this.nextUint() / 0xffffffff) * (max - min); }
  int(min: number, max: number): number { return Math.floor(this.uniform(min, max + 1)); }
  normal(mu = 0, sigma = 1): number {
    // Box–Muller
    let u = 1 - this.uniform();
    let v = this.uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma + mu;
  }
}

/********************
 * Simulation Engine *
 ********************/

class Simulation {
  private rng: RNG;
  private market: Market;

  constructor(private stand: StandState, seed = 42) {
    this.rng = new RNG(seed);
    this.market = new Market(this.rng);
  }

  /** Generate a forecast (player sees this before planning). */
  forecast(): Weather {
    const roll = this.rng.uniform();
    if (roll < 0.10) return new Weather(WeatherKind.Storm, this.rng.int(65, 75));
    if (roll < 0.35) return new Weather(WeatherKind.Cold, this.rng.int(55, 65));
    if (roll < 0.75) return new Weather(WeatherKind.Mild, this.rng.int(70, 84));
    return new Weather(WeatherKind.Hot, this.rng.int(85, 100));
  }

  /** Random supply prices for the current day. */
  prices(dayIndex: number): PriceList { return PriceList.random(dayIndex, this.rng); }

  /** Simulate N days using a player Strategy. */
  runDays(days: number, strategy: Strategy): ReadonlyArray<DayResult> {
    for (let d = 1; d <= days; d++) this.runSingleDay(strategy, d);
    return this.stand.history;
  }

  /** Public, manual one-day runner. Supply a plan (from user input). */
  runDayManual(day: number, plan: DayPlan, weather?: Weather, prices?: PriceList) {
    const w = weather ?? this.forecast();
    const p = prices ?? this.prices(day);
    this.executeDay(plan, day, w, p);
  }

  private runSingleDay(strategy: Strategy, day: number) {
    // Morning: forecast + prices -> player plan
    const weather = this.forecast();
    const prices = this.prices(day);
    const plan = strategy.planDay(this.stand, weather, prices, day);
    this.executeDay(plan, day, weather, prices);
  }

  private executeDay(plan: DayPlan, day: number, weather: Weather, prices: PriceList) {
    // Execute purchase order
    const supplyCost =
      plan.order.lemons * prices.lemonPrice +
      plan.order.sugarCups * prices.sugarPrice +
      plan.order.iceCubes * prices.icePrice +
      plan.order.cups * prices.cupPrice;

    if (supplyCost > this.stand.cash + 1e-9) {
      throw new Error(`Insufficient cash for purchases on day ${day}. Need $${supplyCost.toFixed(2)}, have $${this.stand.cash.toFixed(2)}`);
    }

    this.stand.cash -= supplyCost;
    this.stand.inventory.add(plan.order.lemons, plan.order.sugarCups, plan.order.iceCubes, plan.order.cups);

    // Update price & recipe
    this.stand.pricePerCup = plan.setPricePerCup;
    this.stand.recipe = plan.recipe;

    // Daytime: traffic & sales
    const customers = this.market.customerTraffic(weather);
    let cupsSold = 0;
    for (let i = 0; i < customers; i++) {
      const pBuy = this.market.buyProbability(this.stand.pricePerCup, weather);
      if (this.rng.uniform() <= pBuy) {
        if (this.stand.inventory.pourCup(this.stand.recipe)) {
          cupsSold += 1;
        } else {
          // Stock-out ends further sales for realism
          break;
        }
      }
    }

    const grossRevenue = cupsSold * this.stand.pricePerCup;
    this.stand.cash += grossRevenue;

    // Night: spoilage — ice melts, pitcher resets implicitly next day
    this.stand.inventory.meltIce(1.0);

    const result: DayResult = {
      day,
      weather,
      prices,
      plan,
      customers,
      cupsSold,
      grossRevenue: +grossRevenue.toFixed(2),
      supplyCost: +supplyCost.toFixed(2),
      netProfit: +(grossRevenue - supplyCost).toFixed(2),
      leftover: {
        lemons: this.stand.inventory.lemons,
        sugar: this.stand.inventory.sugar,
        ice: this.stand.inventory.ice,
        cups: this.stand.inventory.cups,
      },
    };

    this.stand.pushHistory(result);
  }
}

/*********************
 * Built-in Strategy  *
 *********************/

/**
 * A simple adaptive strategy:
 * - Buys enough supplies to target inventory for expected traffic.
 * - Adjusts price using a naive rule-of-thumb from yesterday's sell-out.
 */
class GreedyStrategy implements Strategy {
  private targetServiceLevel = 0.8; // aim to serve 80% of forecasted buyers
  private lastSoldOut = false;

  planDay(context: Readonly<StandState>, weather: Weather, prices: PriceList, dayIndex: number): DayPlan {
    // Adjust price based on last day performance
    let price = context.pricePerCup;
    if (dayIndex > 1) {
      if (this.lastSoldOut) price = +(price * 1.10).toFixed(2); // sold out -> raise price
      else price = +(price * 0.97).toFixed(2); // didn’t sell out -> nudge down
      price = Math.max(0.05, Math.min(1.25, price));
    }

    // Rough demand estimate from weather
    const demandHint = this.roughDemand(weather);
    const desiredCups = Math.floor(demandHint * this.targetServiceLevel);

    // Decide recipe (slightly sweeter on cold days to help demand)
    const recipe = new Recipe(
      6,
      weather.kind === WeatherKind.Cold ? 5 : 4,
      weather.kind === WeatherKind.Hot ? 5 : 4,
      12,
    );

    // Compute required ingredients given current inventory
    // Each cup needs 1 cup and ice; lemons/sugar per pitcher.
    const pitchersNeeded = Math.ceil(Math.max(0, desiredCups) / recipe.cupsPerPitcher);
    const needLemons = Math.max(0, pitchersNeeded * recipe.lemonsPerPitcher - context.inventory.lemons);
    const needSugar = Math.max(0, pitchersNeeded * recipe.sugarCupsPerPitcher - context.inventory.sugar);
    const needCups = Math.max(0, desiredCups - context.inventory.cups);
    const needIce = Math.max(0, desiredCups * recipe.iceCubesPerCup - context.inventory.ice);

    // Constrain by available cash (greedy pack in order of ROI: cups, ice, lemons, sugar)
    let order: PurchaseOrder = { lemons: 0, sugarCups: 0, iceCubes: 0, cups: 0 };
    let cash = context.cash;

    const tryBuy = (unitNeed: number, unitPrice: number): number => {
      if (unitNeed <= 0) return 0;
      const maxAffordable = Math.floor(cash / unitPrice);
      const qty = Math.max(0, Math.min(unitNeed, maxAffordable));
      cash -= qty * unitPrice;
      return qty;
    };

    // Prioritize items that directly cap sales
    order.cups = tryBuy(needCups, prices.cupPrice);
    order.iceCubes = tryBuy(needIce, prices.icePrice);
    order.lemons = tryBuy(needLemons, prices.lemonPrice);
    order.sugarCups = tryBuy(needSugar, prices.sugarPrice);

    // Predict sell-out for next iteration's price logic
    const expectedCupsPossible = this.estimateCupsPossibleAfter(order, context.inventory, recipe);
    this.lastSoldOut = expectedCupsPossible < desiredCups;

    return { setPricePerCup: price, order, recipe };
  }

  private roughDemand(weather: Weather): number {
    switch (weather.kind) {
      case WeatherKind.Hot: return 85;
      case WeatherKind.Mild: return 60;
      case WeatherKind.Cold: return 35;
      case WeatherKind.Storm: return 15;
    }
  }

  private estimateCupsPossibleAfter(order: PurchaseOrder, inv: Inventory, recipe: Recipe): number {
    const cups = inv.cups + order.cups;
    const iceCups = Math.floor((inv.ice + order.iceCubes) / recipe.iceCubesPerCup);
    const lemonsPitchers = Math.floor((inv.lemons + order.lemons) / recipe.lemonsPerPitcher);
    const sugarPitchers = Math.floor((inv.sugar + order.sugarCups) / recipe.sugarCupsPerPitcher);
    const pitchers = Math.min(lemonsPitchers, sugarPitchers);
    return Math.min(cups, iceCups, pitchers * recipe.cupsPerPitcher);
  }
}

/**********************
 * Convenience Runner  *
 **********************/

function runDemo() {
  const stand = new StandState(10.00 /* starting cash */);
  const sim = new Simulation(stand, 2025);
  const strat = new GreedyStrategy();
  sim.runDays(10, strat);

  console.log("\n==== RESULTS ====\n");
  for (const r of stand.history) {
    console.log(
      `Day ${r.day}: ${r.weather.forecast()} | $${r.plan.setPricePerCup.toFixed(2)}/cup\n` +
      `  Bought: L=${r.plan.order.lemons}, S=${r.plan.order.sugarCups}c, I=${r.plan.order.iceCubes}, C=${r.plan.order.cups}  (Cost $${r.supplyCost.toFixed(2)})\n` +
      `  Customers=${r.customers}, Sold=${r.cupsSold}, Revenue=$${r.grossRevenue.toFixed(2)}, Net=$${r.netProfit.toFixed(2)}\n` +
      `  Leftover: L=${r.leftover.lemons}, S=${r.leftover.sugar}, I=${r.leftover.ice}, C=${r.leftover.cups}\n`
    );
  }

  const finalCash = stand.cash;
  const totalProfit = stand.history.reduce((acc, d) => acc + d.netProfit, 0);
  console.log(`Final Cash: $${finalCash.toFixed(2)}  (Total Profit over ${stand.history.length} days: $${totalProfit.toFixed(2)})`);
}

// If running under ts-node or bundler, you can call runDemo().
// runDemo();

/*****************
 * CLI Interface *
 *****************/
// Implements a day-at-a-time interactive loop using Node's official
// promise-based readline API (Node v17+):
// https://nodejs.org/api/readline.html (readline/promises)
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function askNumber(rl: ReturnType<typeof createInterface>, prompt: string, def: number, min = 0, max = Number.POSITIVE_INFINITY): Promise<number> {
  while (true) {
    const ans = (await rl.question(`${prompt} [default ${def}]: `)).trim();
    if (ans === '') return def;
    const v = Number(ans);
    if (!Number.isNaN(v) && v >= min && v <= max) return v;
    console.log(`Please enter a number between ${min} and ${max}.`);
  }
}

async function askYesNo(rl: ReturnType<typeof createInterface>, prompt: string, def = false): Promise<boolean> {
  const defText = def ? 'Y/n' : 'y/N';
  while (true) {
    const ans = (await rl.question(`${prompt} [${defText}]: `)).trim().toLowerCase();
    if (ans === '') return def;
    if (['y','yes'].includes(ans)) return true;
    if (['n','no'].includes(ans)) return false;
  }
}

async function runCLI() {
  const rl = createInterface({ input, output });

  console.log('🍋 Lemonade Stand — Day-by-Day CLI');
  const startingCash = await askNumber(rl, 'Starting cash ($)', 10.00, 0);
  let stand = new StandState(startingCash);
  let sim = new Simulation(stand, 2025);

  let day = 1;
  while (true) {
    console.log(`
===== Day ${day} =====`);
    const weather = sim.forecast();
    const prices = sim.prices(day);

    console.log(`Forecast: ${weather.forecast()} (${weather.tempF}°F)`);
    console.log(`Prices — Lemons $${prices.lemonPrice.toFixed(2)}, Sugar/cup $${prices.sugarPrice.toFixed(2)}, Ice/cube $${prices.icePrice.toFixed(2)}, Cups $${prices.cupPrice.toFixed(2)}`);

    // Let the player optionally adjust the recipe
    console.log(`Current recipe: ${stand.recipe.lemonsPerPitcher} lemons/pitcher, ${stand.recipe.sugarCupsPerPitcher} sugar cups/pitcher, ${stand.recipe.iceCubesPerCup} ice/cup, ${stand.recipe.cupsPerPitcher} cups/pitcher.`);
    const tweak = await askYesNo(rl, 'Adjust recipe?', false);
    let recipe = stand.recipe;
    if (tweak) {
      const l = await askNumber(rl, 'Lemons per pitcher', recipe.lemonsPerPitcher, 1, 20);
      const s = await askNumber(rl, 'Sugar cups per pitcher', recipe.sugarCupsPerPitcher, 0, 20);
      const i = await askNumber(rl, 'Ice cubes per cup', recipe.iceCubesPerCup, 0, 20);
      const c = await askNumber(rl, 'Cups per pitcher', recipe.cupsPerPitcher, 1, 25);
      recipe = new Recipe(l, s, i, c);
    }

    // Purchases
    const pricePerCup = await askNumber(rl, 'Set selling price per cup ($)', stand.pricePerCup, 0.01, 5);
    const buyLemons = await askNumber(rl, 'Buy how many lemons?', 0, 0);
    const buySugar = await askNumber(rl, 'Buy how many cups of sugar?', 0, 0);
    const buyIce = await askNumber(rl, 'Buy how many ice cubes?', 0, 0);
    const buyCups = await askNumber(rl, 'Buy how many paper cups?', 0, 0);

    const plan: DayPlan = {
      setPricePerCup: +pricePerCup.toFixed(2),
      order: { lemons: buyLemons, sugarCups: buySugar, iceCubes: buyIce, cups: buyCups },
      recipe,
    };

    try {
      sim.runDayManual(day, plan, weather, prices);
    } catch (e: any) {
      console.error('Purchase error:', e.message ?? e);
      const cont = await askYesNo(rl, 'Try a different order?', true);
      if (cont) continue; else break;
    }

    const r = stand.history[stand.history.length - 1];
    console.log(`
Results — Day ${day}`);
    console.log(`  Customers: ${r.customers}`);
    console.log(`  Cups sold: ${r.cupsSold}`);
    console.log(`  Revenue: $${r.grossRevenue.toFixed(2)}  Supplies cost: $${r.supplyCost.toFixed(2)}  Net: $${r.netProfit.toFixed(2)}`);
    console.log(`  Leftover — Lemons: ${r.leftover.lemons}, Sugar: ${r.leftover.sugar}, Ice: ${r.leftover.ice}, Cups: ${r.leftover.cups}`);
    console.log(`  Cash balance: $${stand.cash.toFixed(2)}`);

    const goOn = await askYesNo(rl, 'Proceed to next day?', true);
    if (!goOn) break;
    day += 1;
  }

  console.log('Thanks for playing!');
  rl.close();
}

// Exported so you can call with tsx/ts-node: `tsx lemonade-stand.ts --cli`
export async function mainCLI() { await runCLI(); }

export {
  WeatherKind,
  Weather,
  Inventory,
  Recipe,
  PriceList,
  PurchaseOrder,
  DayResult,
  DayPlan,
  Strategy,
  StandState,
  Market,
  RNG,
  Simulation,
  GreedyStrategy,
  runDemo,
};
