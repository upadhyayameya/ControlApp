export type Ingredient = { item: string; qty: string }

export type Recipe = {
  id: string
  name: string
  tag: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | 'Shake' | 'Base'
  servings: number
  timeMin: number
  /** Per serving. */
  macros: { kcal: number; p: number; c: number; f: number }
  ingredients: Ingredient[]
  steps: string[]
  why?: string
}

/** All quantities are RAW weights unless stated. Weigh before cooking, always. */
export const RECIPES: Recipe[] = [
  {
    id: 'protein-oats',
    name: 'Protein Oats',
    tag: 'Breakfast',
    servings: 1,
    timeMin: 6,
    macros: { kcal: 480, p: 40, c: 52, f: 12 },
    ingredients: [
      { item: 'Rolled oats', qty: '60 g' },
      { item: 'Milk (toned)', qty: '200 ml' },
      { item: 'Whey protein', qty: '1 scoop / 30 g' },
      { item: 'Peanut butter', qty: '10 g (one level tsp)' },
      { item: 'Cinnamon', qty: 'a pinch' },
      { item: 'Banana (optional, counts extra)', qty: '½' },
    ],
    steps: [
      'Simmer oats in milk for 4 minutes, stirring, until it thickens.',
      'Take it OFF the heat and wait 2 minutes. Whey added to boiling liquid turns grainy.',
      'Stir in the whey, peanut butter and cinnamon.',
    ],
    why: '40 g of protein before 9 a.m. is the easiest win of your day. Get this one habit and half the battle is done.',
  },
  {
    id: 'paneer-bhurji',
    name: 'High-Protein Paneer Bhurji',
    tag: 'Dinner',
    servings: 2,
    timeMin: 20,
    macros: { kcal: 340, p: 30, c: 12, f: 20 },
    ingredients: [
      { item: 'Paneer, crumbled', qty: '300 g' },
      { item: 'Onion, finely chopped', qty: '100 g' },
      { item: 'Tomato, chopped', qty: '150 g' },
      { item: 'Capsicum, chopped', qty: '100 g' },
      { item: 'Ginger-garlic paste', qty: '1 tsp' },
      { item: 'Green chilli', qty: '1' },
      { item: 'Turmeric / red chilli / garam masala', qty: '¼ tsp each' },
      { item: 'Oil', qty: '1 tsp (5 ml) — measured, not poured' },
      { item: 'Coriander', qty: 'a handful' },
    ],
    steps: [
      'Heat the measured oil. Cumin, then onion — cook until translucent, 4 min.',
      'Ginger-garlic and chilli, 30 seconds until it smells cooked, not raw.',
      'Tomato and capsicum, cook until the tomato collapses and the oil separates, 6 min.',
      'Dry spices, 30 seconds.',
      'Fold in the crumbled paneer, cook 3 minutes MAX. Longer and it goes rubbery.',
      'Off the heat, coriander, done.',
    ],
    why: 'Paneer is the vegetarian protein workhorse. The whole dish is 1 tsp of oil — most restaurant bhurji is 4.',
  },
  {
    id: 'soya-keema',
    name: 'Soya Chunk Keema',
    tag: 'Lunch',
    servings: 2,
    timeMin: 25,
    macros: { kcal: 290, p: 32, c: 26, f: 7 },
    ingredients: [
      { item: 'Soya chunks (dry weight)', qty: '80 g' },
      { item: 'Onion', qty: '120 g' },
      { item: 'Tomato', qty: '200 g' },
      { item: 'Ginger-garlic paste', qty: '1½ tsp' },
      { item: 'Green peas', qty: '60 g' },
      { item: 'Garam masala / coriander powder / chilli', qty: '½ tsp each' },
      { item: 'Oil', qty: '1 tsp' },
    ],
    steps: [
      'Boil the soya chunks 5 min. Drain, rinse cold, then SQUEEZE dry twice — hard. This is the whole trick.',
      'Pulse the squeezed chunks in a grinder 2–3 times to a coarse mince. Do not make paste.',
      'Oil, onion until golden-brown (8 min, be patient — this is the flavour).',
      'Ginger-garlic 30 s, tomato until oil separates, 6 min.',
      'Dry spices, then the minced soya and peas. 100 ml water, simmer 8 min covered.',
    ],
    why: '52 g of protein per 100 g dry — the most protein-dense vegetarian food in any Indian kitchen, and the cheapest.',
  },
  {
    id: 'dal-tadka',
    name: 'Dal Tadka (measured)',
    tag: 'Base',
    servings: 4,
    timeMin: 30,
    macros: { kcal: 190, p: 12, c: 28, f: 4 },
    ingredients: [
      { item: 'Toor dal (dry)', qty: '200 g' },
      { item: 'Water', qty: '700 ml' },
      { item: 'Turmeric', qty: '½ tsp' },
      { item: 'Ghee', qty: '2 tsp (10 g) for the whole pot' },
      { item: 'Cumin seeds', qty: '1 tsp' },
      { item: 'Garlic, sliced', qty: '6 cloves' },
      { item: 'Dried red chilli', qty: '2' },
      { item: 'Hing', qty: 'a pinch' },
      { item: 'Tomato', qty: '100 g' },
    ],
    steps: [
      'Rinse dal until the water runs clear. Pressure cook with water, turmeric and salt: 4 whistles, then 8 min on low.',
      'Whisk the cooked dal — it should be pourable, not sludge. Add hot water if needed.',
      'Tadka in strict order: hot ghee → hing → cumin (it must sizzle instantly) → garlic to pale gold → dried chilli 10 s.',
      'Pour the tadka over the dal. Cover for 2 min before serving so the aroma settles in.',
    ],
    why: 'Make this every Sunday. It is the backbone of four lunches and it costs almost nothing.',
  },
  {
    id: 'rajma',
    name: 'Rajma',
    tag: 'Lunch',
    servings: 4,
    timeMin: 40,
    macros: { kcal: 240, p: 14, c: 38, f: 4 },
    ingredients: [
      { item: 'Rajma (dry), soaked overnight', qty: '200 g' },
      { item: 'Onion', qty: '150 g' },
      { item: 'Tomato purée', qty: '250 g' },
      { item: 'Ginger-garlic paste', qty: '2 tsp' },
      { item: 'Rajma masala / garam masala', qty: '1½ tsp' },
      { item: 'Oil', qty: '2 tsp for the whole pot' },
    ],
    steps: [
      'Soak overnight — 8 hours minimum. Un-soaked rajma will never go creamy and will wreck your stomach.',
      'Pressure cook the soaked beans in fresh water with salt: 6 whistles, then 15 min on low.',
      'Brown the onion properly in the oil, 8–10 min. Ginger-garlic, then purée until the oil separates.',
      'Add beans WITH their cooking liquid. Simmer 15 min. Mash a ladleful against the side to thicken it.',
    ],
  },
  {
    id: 'tofu-tikka',
    name: 'Tofu Tikka Tray-Bake',
    tag: 'Dinner',
    servings: 2,
    timeMin: 35,
    macros: { kcal: 310, p: 28, c: 16, f: 16 },
    ingredients: [
      { item: 'Firm tofu', qty: '400 g' },
      { item: 'Hung curd', qty: '100 g' },
      { item: 'Ginger-garlic paste', qty: '1 tsp' },
      { item: 'Tikka masala / chilli / turmeric', qty: '1½ tsp total' },
      { item: 'Lemon juice', qty: '1 tbsp' },
      { item: 'Capsicum + onion, chunked', qty: '250 g' },
      { item: 'Oil', qty: '2 tsp' },
      { item: 'Cornflour', qty: '1 tsp' },
    ],
    steps: [
      'Press the tofu 20 min under something heavy. Wet tofu steams instead of browning — this step is not optional.',
      'Cube it, dust with cornflour (this is what gives you a crust).',
      'Mix hung curd, ginger-garlic, spices, lemon, oil. Coat tofu and veg.',
      'Oven 220 °C for 22 min, turning once. Or air-fry at 200 °C for 15 min.',
    ],
    why: 'Tray-bakes need no attention. Put it in, do your mobility work, take it out.',
  },
  {
    id: 'chole',
    name: 'Chole',
    tag: 'Lunch',
    servings: 4,
    timeMin: 40,
    macros: { kcal: 260, p: 13, c: 40, f: 6 },
    ingredients: [
      { item: 'Chickpeas (dry), soaked overnight', qty: '200 g' },
      { item: 'Onion', qty: '150 g' },
      { item: 'Tomato', qty: '250 g' },
      { item: 'Chole masala', qty: '2 tsp' },
      { item: 'Tea bag (for colour)', qty: '1' },
      { item: 'Oil', qty: '2 tsp' },
      { item: 'Amchur / lemon', qty: '1 tsp' },
    ],
    steps: [
      'Pressure cook the soaked chickpeas with the tea bag in the water: 6 whistles, 15 min low. Remove the bag.',
      'Brown onion deeply, add ginger-garlic, then tomato until the oil separates.',
      'Chole masala 30 s, then the chickpeas with their liquid. Simmer 15 min.',
      'Finish with amchur or lemon off the heat — the sourness is the point of the dish.',
    ],
  },
  {
    id: 'besan-chilla',
    name: 'Besan Chilla',
    tag: 'Breakfast',
    servings: 1,
    timeMin: 12,
    macros: { kcal: 320, p: 18, c: 38, f: 10 },
    ingredients: [
      { item: 'Besan (gram flour)', qty: '80 g' },
      { item: 'Water', qty: '120 ml' },
      { item: 'Onion, tomato, coriander, chopped fine', qty: '100 g total' },
      { item: 'Green chilli, ginger', qty: 'to taste' },
      { item: 'Ajwain', qty: '¼ tsp' },
      { item: 'Oil', qty: '1 tsp total for two chillas' },
    ],
    steps: [
      'Whisk besan and water to a smooth pouring batter — no lumps. Rest it 10 min.',
      'Fold in the vegetables and ajwain.',
      'Non-stick pan, medium heat, ½ tsp oil brushed. Pour and spread thin.',
      'Flip only once the top has set and the edges lift on their own. Two minutes a side.',
    ],
    why: 'Faster than ordering breakfast, and 18 g of protein without touching dairy.',
  },
  {
    id: 'sprout-salad',
    name: 'Sprouted Moong Chaat',
    tag: 'Snack',
    servings: 1,
    timeMin: 8,
    macros: { kcal: 210, p: 14, c: 32, f: 3 },
    ingredients: [
      { item: 'Sprouted moong', qty: '150 g' },
      { item: 'Onion, tomato, cucumber', qty: '100 g' },
      { item: 'Lemon juice', qty: '1 tbsp' },
      { item: 'Chaat masala, black salt', qty: '½ tsp' },
      { item: 'Coriander, pomegranate (optional)', qty: 'a handful' },
    ],
    steps: [
      'Steam the sprouts 4 min if you want them soft — raw is fine too, but harder to digest in quantity.',
      'Toss everything. Add the lemon last so the vegetables stay crisp.',
    ],
  },
  {
    id: 'hung-curd-bowl',
    name: 'Hung Curd Bowl',
    tag: 'Snack',
    servings: 1,
    timeMin: 5,
    macros: { kcal: 190, p: 20, c: 16, f: 5 },
    ingredients: [
      { item: 'Hung curd', qty: '200 g' },
      { item: 'Berries or chopped apple', qty: '80 g' },
      { item: 'Flax or chia seeds', qty: '5 g' },
      { item: 'Honey (optional)', qty: '1 tsp' },
    ],
    steps: ['Combine. That is the whole recipe.'],
    why: 'Hung curd is roughly double the protein of plain curd for the same volume. See the technique on straining.',
  },
  {
    id: 'palak-paneer',
    name: 'Lean Palak Paneer',
    tag: 'Dinner',
    servings: 3,
    timeMin: 30,
    macros: { kcal: 300, p: 22, c: 14, f: 18 },
    ingredients: [
      { item: 'Spinach', qty: '500 g' },
      { item: 'Paneer', qty: '300 g' },
      { item: 'Onion', qty: '100 g' },
      { item: 'Garlic', qty: '6 cloves' },
      { item: 'Green chilli', qty: '2' },
      { item: 'Milk (instead of cream)', qty: '60 ml' },
      { item: 'Oil', qty: '2 tsp' },
    ],
    steps: [
      'Blanch spinach 90 seconds, then straight into ice water. This keeps it green instead of army-brown.',
      'Blend the spinach with the chillies to a coarse purée.',
      'Oil, cumin, garlic, onion — 6 min.',
      'Add the purée, simmer 6 min. Stir in milk, not cream.',
      'Add cubed paneer at the very END, 2 min only.',
    ],
    why: 'Restaurant palak paneer hides 40 g of cream and butter. This version tastes the same and saves you 400 kcal.',
  },
  {
    id: 'shake',
    name: 'Post-Workout Shake',
    tag: 'Shake',
    servings: 1,
    timeMin: 1,
    macros: { kcal: 130, p: 25, c: 4, f: 2 },
    ingredients: [
      { item: 'Whey protein', qty: '1 scoop / 30 g' },
      { item: 'Water', qty: '300 ml' },
      { item: 'Salt', qty: 'a pinch' },
    ],
    steps: ['Shake. Drink within an hour of the last set.'],
    why: 'Water, not milk — milk slows it down and adds calories you would rather eat as food.',
  },
]

export type Technique = { id: string; title: string; body: string }

export const TECHNIQUES: Technique[] = [
  {
    id: 'weigh-raw',
    title: 'Weigh raw, never cooked',
    body: '100 g of raw rice becomes ~260 g cooked. Every macro number in this portal is the RAW weight. Buy a ₹500 kitchen scale — without one you are guessing, and people who guess overshoot by 300–500 kcal a day. This single object is the difference between the plan working and not working.',
  },
  {
    id: 'oil',
    title: 'Oil is the silent killer',
    body: 'One tablespoon of any oil is 120 kcal. Poured freehand from the bottle, most people use 3 tbsp per dish without noticing — that is 360 kcal invisible in your dal. Measure it with a teaspoon. Cap yourself at 3 tsp of cooking oil per day across all meals. Nothing else in vegetarian cooking moves the number this much.',
  },
  {
    id: 'tadka',
    title: 'Tadka order, and why it matters',
    body: 'Hot ghee or oil → hing → mustard seeds (wait for them to pop) → cumin (must sizzle on contact) → dried red chilli, 10 seconds → garlic to pale gold → curry leaves last, they spit. Out of order, you get raw hing and burnt garlic. In order, 2 tsp of fat flavours a whole pot for four people.',
  },
  {
    id: 'hung-curd',
    title: 'Hung curd doubles your protein density',
    body: 'Line a sieve with muslin, tip in 500 g of curd, refrigerate 4 hours over a bowl. You get ~250 g of thick curd at roughly twice the protein per gram, plus whey water — keep it for kneading roti dough. Do a full kilo on Sunday and you have snacks for four days.',
  },
  {
    id: 'soya',
    title: 'Squeeze soya chunks twice',
    body: 'Boil 5 minutes, drain, rinse cold, then squeeze hard — twice. Un-squeezed chunks stay waterlogged, taste of nothing, and refuse to take up marinade. Squeezed, they behave like mince and soak up everything you put on them.',
  },
  {
    id: 'paneer',
    title: 'Paneer goes in last',
    body: 'Paneer turns rubbery after about 4 minutes of cooking. Add it at the end, off-heat if possible. If it has gone hard or came from the fridge, soak it in hot salted water for 10 minutes first — it comes back soft.',
  },
  {
    id: 'tofu',
    title: 'Press tofu, then dust it',
    body: 'Twenty minutes under a heavy pan drives out the water. Then dust with a teaspoon of cornflour before it hits heat. Pressed and dusted, tofu browns and crisps; straight from the pack it steams into a sad grey cube. This one technique is why most people think they dislike tofu.',
  },
  {
    id: 'whistles',
    title: 'Pressure cooker whistle math',
    body: 'Toor / moong dal: 4 whistles + 8 min low. Chana dal: 5 + 10. Rajma (soaked 8 h): 6 + 15. Chickpeas (soaked 8 h): 6 + 15. Rice: 2 whistles, no extra time. Un-soaked beans do not work — no number of whistles will fix it.',
  },
  {
    id: 'batch',
    title: 'The Sunday hour',
    body: 'Two dals, one onion-tomato masala base (500 g onion + 750 g tomato + ginger-garlic, cooked down and frozen in portions), 1 kg curd hung, one tray of roasted vegetables. Sixty minutes on Sunday removes the single most common reason people break a diet on Wednesday: nothing ready, so you order in.',
  },
  {
    id: 'roti-math',
    title: 'Roti and rice math',
    body: 'One roti = 30 g atta = ~105 kcal, 3 g protein. One katori of cooked rice = 50 g raw = ~180 kcal. Two rotis plus one katori of rice at lunch is 390 kcal before anything goes on top of them. Know these two numbers and you never have to log a meal again.',
  },
  {
    id: 'protein-stack',
    title: 'The 160 g stack',
    body: 'Pick any four and you are there: 200 g hung curd (20 g) · 200 g paneer (36 g) · 80 g dry soya (42 g) · 1 whey scoop (25 g) · 200 g tofu (32 g) · 100 g dry dal (24 g) · 80 g besan (18 g). Vegetarians miss protein because they never plan it — stack it first, then fill the rest of the day with whatever you like.',
  },
  {
    id: 'eating-out',
    title: 'Eating out without derailing',
    body: 'Order tandoori over gravy — dry heat instead of a cup of cream. Paneer tikka, tandoori mushroom, dal (not dal makhani), roti (not naan or butter roti), salad. Skip the first bread basket and you have already saved 400 kcal. One restaurant meal a week is planned, not a failure.',
  },
]

/** A default day that hits 2200 kcal / ~160 g protein without any thinking. */
export const DEFAULT_DAY = [
  { time: '07:00', what: 'Black coffee + 500 ml water', macros: '5 kcal' },
  { time: '08:00', what: 'Protein Oats', macros: '480 kcal · 40 P' },
  { time: '11:00', what: 'Hung Curd Bowl', macros: '190 kcal · 20 P' },
  { time: '13:30', what: '2 roti + 250 g dal + 150 g sabzi + big salad', macros: '600 kcal · 28 P' },
  { time: '17:00', what: '30 g roasted chana + black coffee', macros: '130 kcal · 7 P' },
  { time: '19:00', what: 'Train', macros: '—' },
  { time: '20:00', what: 'Post-Workout Shake', macros: '130 kcal · 25 P' },
  { time: '21:00', what: 'Paneer Bhurji (or Tofu Tikka) + salad + 1 roti', macros: '620 kcal · 42 P' },
]
