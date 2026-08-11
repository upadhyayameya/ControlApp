// ---------------------------------------------------------------------------
// The equipment canvas. React Flow renders each placed device as a custom
// node; edges are colored by medium (chilled/hot/condenser water, air,
// electrical) and animate when the connected equipment is running. Dropping a
// wire runs it through validation and shows a plain-English error on failure.
// ---------------------------------------------------------------------------

import { useCallback, useMemo } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection as RfConnection,
  Controls,
  Edge,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  ReactFlowProvider,
} from 'reactflow'
import { useStore } from '../state/store'
import { EquipmentNodeView, NodeData } from './EquipmentNodeView'
import { mediumColor } from './glyphs'

const nodeTypes = { equipment: EquipmentNodeView }

function CanvasInner() {
  const config = useStore((s) => s.config)
  const snapshot = useStore((s) => s.snapshot)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const tryConnect = useStore((s) => s.tryConnect)
  const moveNode = useStore((s) => s.moveNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const deleteConnection = useStore((s) => s.deleteConnection)
  const select = useStore((s) => s.select)
  const connectError = useStore((s) => s.connectError)
  const clearConnectError = useStore((s) => s.clearConnectError)

  const nodes: Node<NodeData>[] = useMemo(
    () =>
      config.nodes.map((n) => ({
        id: n.id,
        type: 'equipment',
        position: n.position,
        data: { node: n },
        selected: n.id === selectedNodeId,
      })),
    [config.nodes, selectedNodeId],
  )

  const edges: Edge[] = useMemo(
    () =>
      config.connections.map((c) => {
        const srcRunning = snapshot?.nodeStates[c.source]?.running
        const dstRunning = snapshot?.nodeStates[c.target]?.running
        const active = c.kind !== 'electrical' && (srcRunning || dstRunning)
        return {
          id: c.id,
          source: c.source,
          target: c.target,
          sourceHandle: c.sourcePort,
          targetHandle: c.targetPort,
          animated: !!active,
          style: { stroke: mediumColor(c.medium), strokeWidth: 2.5 },
        }
      }),
    [config.connections, snapshot],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) moveNode(ch.id, ch.position)
        else if (ch.type === 'remove') deleteNode(ch.id)
      }
    },
    [moveNode, deleteNode],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) if (ch.type === 'remove') deleteConnection(ch.id)
    },
    [deleteConnection],
  )

  const onConnect = useCallback(
    (c: RfConnection) => {
      if (c.source && c.target && c.sourceHandle && c.targetHandle) {
        tryConnect(c.source, c.sourceHandle, c.target, c.targetHandle)
      }
    },
    [tryConnect],
  )

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a3a2e" />
        <Controls className="!bg-panel-700 !border-forest-700" />
        <MiniMap
          pannable
          zoomable
          className="!bg-panel-800"
          nodeColor={() => '#2f6b3d'}
          maskColor="rgba(10,20,15,0.6)"
        />
      </ReactFlow>

      {connectError && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 max-w-md rounded-md border border-alarm-warning bg-panel-800 px-4 py-2 text-sm text-cream-100 shadow-lg">
          <div className="flex items-start gap-2">
            <span className="text-alarm-warning">⚠</span>
            <span>{connectError}</span>
            <button className="ml-2 text-forest-300 hover:text-cream-100" onClick={clearConnectError}>
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 z-10 flex gap-3 rounded-md bg-panel-800/90 px-3 py-1.5 text-[10px] text-cream-100 border border-forest-700">
        <Legend color="#3b9ed6" label="CHW" />
        <Legend color="#d64545" label="HW" />
        <Legend color="#7c8aa5" label="CW" />
        <Legend color="#5bb98c" label="Air" />
        <Legend color="#e0b23a" label="Elec" />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-4 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
