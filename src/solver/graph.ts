import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import {
  buildings,
  generators as allGenerators,
  items,
  itemName,
} from '../data/gameData'
import type { PlanResult } from './interpret'
import { num } from '../format'

export type FlowNodeKind =
  | 'extract'
  | 'recipe'
  | 'generator'
  | 'target'
  | 'surplus'
  | 'hub'

export interface FlowNodeData extends Record<string, unknown> {
  kind: FlowNodeKind
  /** Icon stem for the machine or item this node represents. */
  icon?: string | null
  title: string
  subtitle: string
  /** Rate lines shown inside the node body. */
  detail: string[]
  machines?: number
  wholeMachines?: number
  clock?: number
  power?: number
}

export const NODE_WIDTH = 200
const HEADER_HEIGHT = 56
const LINE_HEIGHT = 16
const BODY_PADDING = 14

/** One side of an item's flow: a node and the rate it contributes. */
interface Flow {
  node: string
  rate: number
}

export const fmtRate = (rate: number) => num(rate)

function nodeHeight(data: FlowNodeData) {
  return HEADER_HEIGHT + data.detail.length * LINE_HEIGHT + BODY_PADDING
}

export function buildFlowGraph(
  result: PlanResult,
  targets: Record<string, number>,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = []
  const producers = new Map<string, Flow[]>()
  const consumers = new Map<string, Flow[]>()

  const addFlow = (
    map: Map<string, Flow[]>,
    item: string,
    node: string,
    rate: number,
  ) => {
    if (rate <= 1e-9) return
    const list = map.get(item) ?? []
    list.push({ node, rate })
    map.set(item, list)
  }

  const push = (id: string, data: FlowNodeData) => {
    nodes.push({ id, type: 'factory', position: { x: 0, y: 0 }, data })
  }

  for (const e of result.extraction) {
    const id = `extract:${e.item}`
    push(id, {
      kind: 'extract',
      icon: items[e.item]?.icon,
      title: itemName(e.item),
      subtitle:
        e.cap === null ? 'Unlimited supply' : `${fmtRate(e.cap)}/min available`,
      detail: [`${fmtRate(e.rate)}/min extracted`],
    })
    addFlow(producers, e.item, id, e.rate)
  }

  for (const g of result.machineGroups) {
    const id = `recipe:${g.recipe}`
    push(id, {
      kind: 'recipe',
      icon: buildings[g.building]?.icon,
      title: g.recipeName,
      subtitle: `${g.wholeMachines}x ${g.buildingName} @ ${num(g.clock * 100)}%`,
      detail: [
        ...g.outputs.map((o) => `→ ${fmtRate(o.rate)} ${itemName(o.item)}`),
        ...g.inputs.map((i) => `← ${fmtRate(i.rate)} ${itemName(i.item)}`),
      ],
      machines: g.machines,
      wholeMachines: g.wholeMachines,
      clock: g.clock,
      power: g.powerAtClock,
    })
    for (const o of g.outputs) addFlow(producers, o.item, id, o.rate)
    for (const i of g.inputs) addFlow(consumers, i.item, id, i.rate)
  }

  for (const g of result.generatorGroups) {
    const id = `generator:${g.generator}:${g.fuel}`
    const gen = allGenerators[g.generator]
    const detail = [`${fmtRate(g.fuelRate)} ${itemName(g.fuel)} burned`]
    if (g.waterRate > 0) detail.push(`${fmtRate(g.waterRate)} water`)
    detail.push(`${num(g.power)} MW produced`)

    push(id, {
      kind: 'generator',
      icon: allGenerators[g.generator]?.icon,
      title: g.generatorName,
      subtitle: `${g.wholeCount}x on ${itemName(g.fuel)}`,
      detail,
      power: g.power,
    })

    addFlow(consumers, g.fuel, id, g.fuelRate)
    if (gen?.supplemental && g.waterRate > 0) {
      addFlow(consumers, gen.supplemental.item, id, g.waterRate)
    }
    const byproduct = gen?.fuels.find((f) => f.item === g.fuel)?.byproduct
    if (byproduct) {
      addFlow(producers, byproduct.item, id, byproduct.rate * g.count)
    }
  }

  for (const [item, rate] of Object.entries(targets)) {
    if (rate <= 0) continue
    const id = `target:${item}`
    push(id, {
      kind: 'target',
      icon: items[item]?.icon,
      title: itemName(item),
      subtitle: 'Factory output',
      detail: [`${fmtRate(rate)}/min delivered`],
    })
    addFlow(consumers, item, id, rate)
  }

  for (const s of result.surplus) {
    const id = `surplus:${s.item}`
    push(id, {
      kind: 'surplus',
      icon: items[s.item]?.icon,
      title: itemName(s.item),
      subtitle: 'Unused surplus',
      detail: [`${fmtRate(s.rate)}/min left over`],
    })
    addFlow(consumers, s.item, id, s.rate)
  }

  const addHub = (item: string, rate: number) => {
    const id = `hub:${item}`
    push(id, {
      kind: 'hub',
      icon: items[item]?.icon,
      title: itemName(item),
      subtitle: 'Shared bus',
      detail: [`${fmtRate(rate)}/min through`],
    })
    return id
  }

  return { nodes, edges: linkFlows(producers, consumers, addHub) }
}

/**
 * Connects producers to consumers per item.
 *
 * When an item has several producers *and* several consumers, every pair would
 * need its own edge (3 producers x 4 consumers = 12 lines), which is what turns
 * the graph into a hairball. Those cases get a hub node instead, so 3 + 4 = 7
 * lines, which is also what you build in game: one bus everything taps.
 */
function linkFlows(
  producers: Map<string, Flow[]>,
  consumers: Map<string, Flow[]>,
  addHub: (item: string, rate: number) => string,
): Edge[] {
  const edges: Edge[] = []

  const connect = (
    from: string,
    to: string,
    item: string,
    rate: number,
    total: number,
  ) => {
    if (rate <= 1e-6) return
    edges.push({
      id: `${from}->${to}:${item}`,
      source: from,
      target: to,
      label: `${fmtRate(rate)} ${itemName(item)}`,
      data: { item, rate },
      // Thicker lines for the bulk flows, so the spine is readable at a glance.
      style: {
        strokeWidth: total > 0 ? 1 + Math.min(3, (rate / total) * 3) : 1.5,
      },
    })
  }

  for (const [item, outs] of producers) {
    const ins = consumers.get(item) ?? []
    const totalDemand = ins.reduce((sum, f) => sum + f.rate, 0)
    if (totalDemand <= 0) continue

    const totalSupply = outs.reduce((sum, f) => sum + f.rate, 0)

    if (outs.length > 1 && ins.length > 1) {
      const hub = addHub(item, totalSupply)
      for (const producer of outs) {
        connect(producer.node, hub, item, producer.rate, totalSupply)
      }
      for (const consumer of ins) {
        connect(hub, consumer.node, item, consumer.rate, totalSupply)
      }
      continue
    }

    // One side is single, so proportional split is exact.
    for (const producer of outs) {
      for (const consumer of ins) {
        const rate = producer.rate * (consumer.rate / totalDemand)
        connect(producer.node, consumer.node, item, rate, totalSupply)
      }
    }
  }

  return edges
}

export function layoutGraph(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
): Node<FlowNodeData>[] {
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setGraph({
    rankdir: 'LR',
    // Enough rank gap for the rate labels without making a deep chain so wide
    // that fitting it on screen renders the text unreadable.
    nodesep: 26,
    // A long chain multiplies this by its depth. Wide gaps push the whole graph
    // past the pane, and fitting it then shrinks the nodes past reading size.
    ranksep: 96,
    edgesep: 16,
    marginx: 32,
    marginy: 32,
    ranker: 'network-simplex',
  })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: nodeHeight(node.data) })
  }

  // Weighting by throughput makes dagre straighten the high-volume lines and
  // bend the trickles around them, which is the readable outcome.
  const maxRate = Math.max(
    1,
    ...edges.map((e) => (e.data?.rate as number | undefined) ?? 0),
  )
  for (const edge of edges) {
    const rate = (edge.data?.rate as number | undefined) ?? 0
    graph.setEdge(
      edge.source,
      edge.target,
      { weight: 1 + Math.round((rate / maxRate) * 8), minlen: 1 },
      edge.id,
    )
  }

  dagre.layout(graph)

  return nodes.map((node) => {
    const positioned = graph.node(node.id)
    if (!positioned) return node
    const height = nodeHeight(node.data)
    return {
      ...node,
      // dagre reports centres; React Flow positions by the top-left corner.
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - height / 2,
      },
      // The minimap draws from these rather than from the rendered DOM, so
      // without them it comes up empty.
      width: NODE_WIDTH,
      height,
    }
  })
}
