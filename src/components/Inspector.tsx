// ---------------------------------------------------------------------------
// Equipment inspector. Model dropdown (curated real units) pre-fills nameplate;
// every field stays editable. Below: the control-sequence editor and the
// interlock-chain "why is this not running?" tracer.
// ---------------------------------------------------------------------------

import { useStore } from '../state/store'
import { catalogFor } from '../data/catalog'
import { nameplateSchema, CATEGORY_LABELS } from '../data/schema'
import { NumberField, Row, Section, Select } from './fields'
import { SequenceEditor } from './SequenceEditor'
import { CATEGORY_ICON } from './glyphs'

export function Inspector() {
  const selectedId = useStore((s) => s.selectedNodeId)
  const node = useStore((s) => s.config.nodes.find((n) => n.id === s.selectedNodeId) ?? null)
  const nodeState = useStore((s) => (selectedId ? s.snapshot?.nodeStates[selectedId] : undefined))
  const updateNode = useStore((s) => s.updateNode)
  const updateNameplate = useStore((s) => s.updateNameplate)
  const applyCatalog = useStore((s) => s.applyCatalog)
  const deleteNode = useStore((s) => s.deleteNode)
  const askWhy = useStore((s) => s.askWhy)
  const why = useStore((s) => s.why)
  const whyLoading = useStore((s) => s.whyLoading)

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-forest-300">
        Select a device on the canvas to edit its nameplate and control sequences.
      </div>
    )
  }

  const catalog = catalogFor(node.category)
  const schema = nameplateSchema(node.category)
  const running = !!nodeState?.running

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-forest-800 px-3 py-2">
        <span className="text-lg">{CATEGORY_ICON[node.category]}</span>
        <div className="min-w-0 flex-1">
          <input
            value={node.name}
            onChange={(e) => updateNode(node.id, { name: e.target.value })}
            className="w-full bg-transparent text-sm font-semibold text-cream-100 focus:outline-none"
          />
          <div className="text-[10px] text-forest-300">{CATEGORY_LABELS[node.category]}</div>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-alarm-ok' : 'bg-gray-600'}`} title={running ? 'Running' : 'Off'} />
        <button onClick={() => deleteNode(node.id)} className="text-forest-300 hover:text-alarm-critical" title="Delete device">
          🗑
        </button>
      </div>

      <Section title="Manufacturer / Model">
        {catalog.length > 0 && (
          <Row label="Catalog">
            <Select
              value={node.catalogId ?? ''}
              options={[{ value: '', label: '— custom —' }, ...catalog.map((c) => ({ value: c.id, label: `${c.manufacturer} ${c.model}` }))]}
              onChange={(v) => v && applyCatalog(node.id, v)}
            />
          </Row>
        )}
        <Row label="Manufacturer">
          <input value={node.manufacturer} onChange={(e) => updateNode(node.id, { manufacturer: e.target.value })} className="readout w-28 rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-[11px] text-cream-100 focus:border-copper-400 focus:outline-none" />
        </Row>
        <Row label="Model">
          <input value={node.model} onChange={(e) => updateNode(node.id, { model: e.target.value })} className="readout w-28 rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-[11px] text-cream-100 focus:border-copper-400 focus:outline-none" />
        </Row>
      </Section>

      <Section title="Nameplate">
        {schema.map((f) => (
          <Row key={f.key} label={f.label}>
            <NumberField value={node.nameplate[f.key] ?? f.default} step={f.step} unit={f.unit} onChange={(v) => updateNameplate(node.id, f.key, v)} />
          </Row>
        ))}
      </Section>

      <SequenceEditor node={node} />

      <Section title="Why is this not running?">
        <button
          onClick={() => askWhy(node.id)}
          className="w-full rounded bg-forest-600 px-2 py-1 text-[11px] font-medium text-cream-50 hover:bg-forest-500 transition-colors"
        >
          Trace interlocks
        </button>
        {whyLoading && <div className="pt-2 text-[11px] text-forest-300">Tracing…</div>}
        {why && why.nodeId === node.id && (
          <div className="pt-2">
            <div className={`text-[11px] font-medium ${why.running ? 'text-alarm-ok' : 'text-alarm-warning'}`}>{why.headline}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {why.chain.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10.5px]">
                  <span className={c.ok ? 'text-alarm-ok' : 'text-alarm-critical'}>{c.ok ? '✓' : '✕'}</span>
                  <div>
                    <span className="text-cream-100">{c.label}</span>
                    <div className="text-forest-300">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
