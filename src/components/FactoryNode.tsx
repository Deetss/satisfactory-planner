import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { FlowNodeData } from '../solver/graph'
import { Icon } from './Icon'
import { num } from '../format'

export function FactoryNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div className={`fnode fnode--${data.kind}`}>
      <Handle type="target" position={Position.Left} />
      <div className="fnode__title">
        <Icon icon={data.icon} name={data.title} size={16} />
        <span>{data.title}</span>
      </div>
      <div className="fnode__subtitle">{data.subtitle}</div>
      <ul className="fnode__detail">
        {data.detail.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {data.power !== undefined && data.kind === 'recipe' && (
        <div className="fnode__power">{num(data.power)} MW</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
