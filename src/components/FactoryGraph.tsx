import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo } from 'react'
import { buildFlowGraph, layoutGraph, type FlowNodeData } from '../solver/graph'
import type { PlanResult } from '../solver/interpret'
import { FactoryNode } from './FactoryNode'

const nodeTypes = { factory: FactoryNode }

const NODE_COLORS: Record<string, string> = {
  extract: '#8b6f47',
  recipe: '#2f6f8f',
  generator: '#8f5a2f',
  target: '#3f7f4f',
  surplus: '#8f3f4f',
  hub: '#5a5f6b',
}

interface Props {
  result: PlanResult
  targets: Record<string, number>
}

const FIT = { padding: 0.12, maxZoom: 1 }

/**
 * Keeps the graph in frame.
 *
 * The `fitView` prop only fits once, on mount. A new plan is a different shape
 * and a resized pane is a different frame, and either one leaves the old fit
 * showing empty space with the nodes off the edge.
 */
function KeepInView({ signature }: { signature: string }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    // One frame's delay lets the new nodes be measured first.
    const id = requestAnimationFrame(() => void fitView(FIT))
    return () => cancelAnimationFrame(id)
  }, [signature, fitView])

  useEffect(() => {
    const pane = document.querySelector('.react-flow')
    if (!pane || typeof ResizeObserver === 'undefined') return

    let first = true
    const observer = new ResizeObserver(() => {
      // The observer fires once on attach, when the fit above already ran.
      if (first) {
        first = false
        return
      }
      void fitView(FIT)
    })
    observer.observe(pane)
    return () => observer.disconnect()
  }, [fitView])

  return null
}

export function FactoryGraph({ result, targets }: Props) {
  const { nodes, edges } = useMemo(() => {
    const graph = buildFlowGraph(result, targets)
    return { nodes: layoutGraph(graph.nodes, graph.edges), edges: graph.edges }
  }, [result, targets])

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>Add a target item and rate to see the production graph.</p>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      // Deep chains fit at a low zoom; capping it stops a two-node plan from
      // being blown up to fill the pane.
      fitViewOptions={FIT}
      minZoom={0.05}
      nodesConnectable={false}
      elevateEdgesOnSelect
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        // Orthogonal-ish routing reads far better than bezier on a dense DAG.
        type: 'smoothstep',
        style: { stroke: '#5b6b7a' },
        labelStyle: { fill: '#c8d2dc', fontSize: 10 },
        labelBgStyle: { fill: '#131a22', fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
      }}
    >
      <KeepInView signature={`${nodes.length}:${edges.length}`} />
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#243040" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node: Node<FlowNodeData>) =>
          NODE_COLORS[node.data.kind] ?? '#555'
        }
        nodeStrokeWidth={0}
        nodeBorderRadius={2}
        maskColor="rgba(8, 12, 17, 0.72)"
        // Smaller than the default, which took a big bite out of the corner.
        style={{ background: '#0d1218', width: 150, height: 110 }}
      />
    </ReactFlow>
  )
}
