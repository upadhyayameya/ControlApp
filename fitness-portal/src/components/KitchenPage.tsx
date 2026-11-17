import { useState } from 'react'
import { RECIPES, TECHNIQUES, DEFAULT_DAY, type Recipe } from '../data/recipes'
import { DAILY } from '../data/profile'
import { Card, Pill } from './ui'

const TAGS = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Snack', 'Shake', 'Base'] as const

export default function KitchenPage() {
  const [tag, setTag] = useState<(typeof TAGS)[number]>('All')
  const [open, setOpen] = useState<string | null>(null)
  const shown = tag === 'All' ? RECIPES : RECIPES.filter((r) => r.tag === tag)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Kitchen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vegetarian, measured, no eggs. Every quantity is a raw weight — weigh before cooking.
        </p>
      </div>

      <Card title="Your daily numbers" sub="Hit the protein. Everything else has slack in it.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: 'Calories', v: DAILY.kcal, u: 'kcal' },
            { k: 'Protein', v: DAILY.proteinG, u: 'g' },
            { k: 'Carbs', v: DAILY.carbG, u: 'g' },
            { k: 'Fat', v: DAILY.fatG, u: 'g' },
          ].map((m) => (
            <div key={m.k} className="rounded-lg bg-ink px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{m.k}</div>
              <div className="text-lg font-semibold tabular-nums text-slate-100">
                {m.v}
                <span className="ml-1 text-xs font-normal text-slate-500">{m.u}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Built from a {Math.round(DAILY.kcal + 600)} kcal maintenance estimate minus 600 — about
          0.6 kg a week. Protein is set at 1.7 g per kg of bodyweight, which is what protects muscle
          while you are in a deficit. Cooking oil capped at {DAILY.cookingOilTsp} tsp a day.
        </p>
      </Card>

      <Card title="A default day" sub="When you cannot be bothered to think, eat this. It lands on target.">
        <ul className="divide-y divide-ink-line">
          {DEFAULT_DAY.map((row) => (
            <li key={row.time} className="flex items-baseline gap-3 py-2">
              <span className="w-12 shrink-0 text-xs tabular-nums text-slate-600">{row.time}</span>
              <span className="flex-1 text-sm text-slate-200">{row.what}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{row.macros}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                t === tag
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-line text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {shown.map((r) => (
            <RecipeCard key={r.id} recipe={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </div>
      </div>

      <Card title="Techniques" sub="The things that decide whether any of the above tastes good or works at all.">
        <div className="space-y-4">
          {TECHNIQUES.map((t) => (
            <div key={t.id}>
              <h3 className="text-sm font-semibold text-slate-100">{t.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{t.body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function RecipeCard({ recipe, open, onToggle }: { recipe: Recipe; open: boolean; onToggle: () => void }) {
  const m = recipe.macros
  return (
    <article className="card">
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{recipe.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill>{recipe.tag}</Pill>
            <Pill>{recipe.timeMin} min</Pill>
            <Pill>
              serves {recipe.servings}
            </Pill>
            <Pill tone="accent">{m.p} g protein</Pill>
          </div>
        </div>
        <span className="shrink-0 text-xs text-slate-600">{open ? '−' : '+'}</span>
      </button>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          { k: 'kcal', v: m.kcal },
          { k: 'P', v: `${m.p} g` },
          { k: 'C', v: `${m.c} g` },
          { k: 'F', v: `${m.f} g` },
        ].map((x) => (
          <div key={x.k} className="rounded-lg bg-ink px-2 py-1.5">
            <div className="text-[10px] uppercase text-slate-600">{x.k}</div>
            <div className="text-sm font-semibold tabular-nums text-slate-200">{x.v}</div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-600">per serving</p>

      {open && (
        <div className="mt-4 space-y-4 border-t border-ink-line pt-4">
          <div>
            <h4 className="label">Ingredients</h4>
            <ul className="divide-y divide-ink-line">
              {recipe.ingredients.map((ing) => (
                <li key={ing.item} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="text-slate-300">{ing.item}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{ing.qty}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="label">Method</h4>
            <ol className="space-y-2">
              {recipe.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-400">
                  <span className="shrink-0 font-semibold tabular-nums text-accent">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
          {recipe.why && (
            <p className="rounded-lg bg-ink p-3 text-xs leading-relaxed text-slate-400">{recipe.why}</p>
          )}
        </div>
      )}
    </article>
  )
}
