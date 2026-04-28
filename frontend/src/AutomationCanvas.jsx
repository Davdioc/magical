import { useEffect, useRef, useState } from 'react'

const NODE_W = 220
const NODE_H = 60
const GAP_X = 60
const GAP_Y = 100
const PAD_X = 60
const PAD_Y = 60

const CHIP_ID = /"id":\s*"([^"]+)"/

const extractAgentId = (chipString) => {
  if (typeof chipString !== 'string') return null
  const match = chipString.match(CHIP_ID)
  return match ? match[1] : null
}

const buildLayout = (automation, availableWidth, availableHeight) => {
  const agents = Array.isArray(automation?.agents) ? automation.agents : []
  const byId = new Map(agents.map((a) => [a.id, a]))

  const queueTargets = new Map()
  for (const agent of agents) {
    const targets = new Set()
    for (const cmd of agent?.instructionsDoc?.commands ?? []) {
      if (cmd.commandId === 'queueAgents') {
        const id = extractAgentId(cmd?.input?.agent)
        if (id) targets.add(id)
      }
    }
    for (const id of agent?.config?.queueableAgentIds ?? []) targets.add(id)
    queueTargets.set(agent.id, targets)
  }

  const edgeSet = new Set()
  const edges = []
  const addEdge = (fromId, toId) => {
    if (!byId.has(toId) || toId === fromId) return
    const key = `${fromId}->${toId}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push({ from: fromId, to: toId, dashed: queueTargets.get(fromId)?.has(toId) ?? false })
  }
  for (const agent of agents) {
    for (const toId of agent?.nextAgentIds ?? []) addEdge(agent.id, toId)
    for (const cmd of agent?.instructionsDoc?.commands ?? []) {
      if (cmd.commandId !== 'callSpecializedAgent' && cmd.commandId !== 'queueAgents') continue
      const toId = extractAgentId(cmd?.input?.agent)
      if (toId) addEdge(agent.id, toId)
    }
  }

  const incoming = new Map(agents.map((a) => [a.id, 0]))
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) || 0) + 1)

  const levels = new Map()
  const queue = []
  for (const a of agents) {
    if ((incoming.get(a.id) || 0) === 0) { levels.set(a.id, 0); queue.push(a.id) }
  }
  while (queue.length) {
    const id = queue.shift()
    const level = levels.get(id)
    for (const e of edges) {
      if (e.from !== id) continue
      const existing = levels.get(e.to)
      if (existing === undefined || existing < level + 1) { levels.set(e.to, level + 1); queue.push(e.to) }
    }
  }
  let fallback = 0
  for (const a of agents) { if (!levels.has(a.id)) levels.set(a.id, fallback++) }

  const byLevel = new Map()
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(id)
  }

  const maxLevelWidth = Math.max(1, ...Array.from(byLevel.values(), (ids) => ids.length))
  const contentWidth = PAD_X * 2 + maxLevelWidth * NODE_W + (maxLevelWidth - 1) * GAP_X
  const maxLevel = Math.max(0, ...Array.from(byLevel.keys()))
  const contentHeight = PAD_Y * 2 + (maxLevel + 1) * NODE_H + maxLevel * GAP_Y
  const layoutW = Math.max(contentWidth, availableWidth)
  const layoutH = Math.max(contentHeight, availableHeight)

  const positions = new Map()
  for (const [level, ids] of byLevel) {
    const count = ids.length
    const rowWidth = count * NODE_W + (count - 1) * GAP_X
    const rowStart = (layoutW - rowWidth) / 2
    ids.forEach((id, i) => positions.set(id, { x: rowStart + i * (NODE_W + GAP_X), y: PAD_Y + level * (NODE_H + GAP_Y) }))
  }

  const nodes = agents.map((a) => ({
    id: a.id,
    name: a.name || 'Unnamed',
    type: a.type,
    environment: a?.config?.environmentOptions?.environment,
    pos: positions.get(a.id) ?? { x: PAD_X, y: PAD_Y },
  }))

  return { nodes, edges, width: layoutW, height: layoutH }
}

const VARIANT_COLORS = {
  orchestrator: { bg: '#FFF0B8', icon: '#705000' },
  browser:      { bg: '#DCEBFE', icon: '#1E3FAE' },
  extract:      { bg: '#F5F3FF', icon: '#7C3AED' },
  desktop:      { bg: '#DCEBFE', icon: '#1E3FAE' },
}

const nodeVariant = (node) => {
  if (node.type === 'extract') return 'extract'
  if (node.environment === 'browser') return 'browser'
  if (node.environment === 'desktop') return 'desktop'
  return 'orchestrator'
}


// Orchestrate — eye-off style icon
const OrchestratorIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M4 4l16 16" />
  </svg>
)

// Globe — matches Magical's Browser icon
const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.333 3.333 3.5 6 3.5 9s-1.167 5.667-3.5 9" />
    <path d="M12 3c-2.333 3.333-3.5 6-3.5 9s1.167 5.667 3.5 9" />
  </svg>
)

// File / Extract — matches Magical's File icon
const FileIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8M16 17H8M10 9H8" />
  </svg>
)

// Desktop — matches Magical's Desktop icon
const DesktopIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)
const NodeIcon = ({ variant }) => {
  if (variant === 'browser') return <GlobeIcon />
  if (variant === 'extract') return <FileIcon />
  if (variant === 'desktop') return <DesktopIcon />
  return <OrchestratorIcon />
}

const agentVariant = (agent) =>
  nodeVariant({ type: agent?.type, environment: agent?.config?.environmentOptions?.environment })

const MODEL_LABEL = (model) => {
  if (!model) return '—'
  if (model.type === 'model-pool') return 'Model pool'
  return model.id ?? '—'
}

const TOOL_ICON = {
  reportStop: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none"/></svg>,
  callSpecializedAgent: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>,
  queueAgents: <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none"/><line x1="19" y1="3" x2="19" y2="21"/></svg>,
  requestHumanIntervention: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 14v1a7 7 0 0 0 14 0v-1"/></svg>,
  click: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>,
  clickFill: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  downloadFile: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  copy: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
}
const DefaultToolIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg>

const ToolChip = ({ name }) => (
  <span className="np-tool-chip">
    <span className="np-tool-chip-icon">{TOOL_ICON[name] ?? DefaultToolIcon}</span>
    {name}
  </span>
)

const parseInstructionText = (text, agentById) => {
  if (!text) return null
  const chipRegex = /:chip\{"id":"([^"]+)","groupId":"[^"]+"\}/g
  const parts = []
  let lastIndex = 0
  let match
  while ((match = chipRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const a = agentById?.get(match[1])
    const v = a ? agentVariant(a) : 'browser'
    const c = VARIANT_COLORS[v]
    parts.push(
      <span key={match.index} className="np-inline-agent-chip" style={{ background: c.bg, color: c.icon }}>
        <span className="np-inline-chip-icon"><NodeIcon variant={v} /></span>
        {a?.name ?? match[1]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}

function CommandStep({ cmd, index, agentById }) {
  const { commandId, input = {} } = cmd
  if (commandId === 'custom') {
    return (
      <div className="np-step">
        <div className="np-step-header">
          <span className="np-step-num">{index + 1}</span>
          <span className="np-step-badge">custom</span>
        </div>
        <div className="np-step-body">
          <p className="np-step-text">{parseInstructionText(input?.instructions ?? '', agentById)}</p>
        </div>
      </div>
    )
  }
  if (commandId === 'queueAgents' || commandId === 'callSpecializedAgent') {
    const agentId = extractAgentId(input?.agent)
    const a = agentById?.get(agentId)
    const v = a ? agentVariant(a) : 'browser'
    const c = VARIANT_COLORS[v]
    const params = Object.entries(input).filter(([k]) => k !== 'agent' && k !== 'waitUponQueueing')
    return (
      <div className="np-step">
        <div className="np-step-header">
          <span className="np-step-num">{index + 1}</span>
          <span className="np-step-badge">{commandId}</span>
        </div>
        <div className="np-step-body">
          <div className="np-step-row">
            <span className="np-step-key">agent:</span>
            <span className="np-inline-agent-chip" style={{ background: c.bg, color: c.icon }}>
              <span className="np-inline-chip-icon"><NodeIcon variant={v} /></span>
              {a?.name ?? agentId}
            </span>
          </div>
          {input.waitUponQueueing !== undefined && (
            <div className="np-step-row">
              <span className="np-step-key">waitUponQueueing:</span>
              <span className="np-step-val-box">{String(input.waitUponQueueing)}</span>
            </div>
          )}
          {params.map(([key, val]) => (
            <div key={key} className="np-step-row">
              <span className="np-step-key">{key}:</span>
              <span className="np-step-val-box">{String(val)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  const params = Object.entries(input)
  return (
    <div className="np-step">
      <div className="np-step-header">
        <span className="np-step-num">{index + 1}</span>
        <span className="np-step-badge">{commandId}</span>
      </div>
      {params.length > 0 && (
        <div className="np-step-body">
          {params.map(([key, val]) => (
            <div key={key} className="np-step-row">
              <span className="np-step-key">{key}:</span>
              <span className="np-step-val-box">{String(val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const variablePrefix = (schema) => (schema?.type === 'number' ? '#' : 'T')

const FieldChip = ({ name, schema, mode = 'variable' }) => {
  const isFile = mode === 'file'
  const prefix = variablePrefix(schema)
  const isNum = !isFile && schema?.type === 'number'
  return (
    <span className={`np-chip${isNum ? ' np-chip-num' : ''}`}>
      <span className={`np-chip-type${isFile ? ' np-chip-type-file' : ''}`}>
        {isFile ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
          </svg>
        ) : prefix}
      </span>
      <span className="np-chip-label">{name}</span>
      <span className="np-chip-close" aria-hidden="true">×</span>
    </span>
  )
}

function NodePanel({ agent, variant, agentById, onClose }) {
  const [stepsOpen, setStepsOpen] = useState(false)
  const env = agent?.config?.environmentOptions
  const inputProps = Object.entries(agent?.inputSchema?.properties ?? {})
  const outputProps = Object.entries(agent?.outputSchema?.properties ?? {})
  const isFileAgent = variant === 'extract'
  const isBrowserAgent = variant === 'browser'
  const model = MODEL_LABEL(agent?.config?.model)
  const maxSec = agent?.config?.limitations?.maxDurationSeconds
  const maxMin = maxSec != null ? Math.round(maxSec / 60) : null
  const maxToolCalls = agent?.config?.limitations?.maxToolCalls
  const tools = agent?.config?.tools ?? []
  const queueableIds = agent?.config?.queueableAgentIds ?? []
  const commands = [...(agent?.instructionsDoc?.commands ?? [])].sort((a, b) => (a.orderKey ?? 0) - (b.orderKey ?? 0))

  return (
    <div className="node-panel">
      <button type="button" className="node-panel-close" onClick={onClose} aria-label="Close panel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>

      <div className="node-panel-body">
        <h2 className="node-panel-title">{agent.name}</h2>

        <div className="node-panel-actions">
          <button type="button" className="np-action-primary">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>
            Try it
          </button>
          <button type="button" className="np-action-icon" aria-label="Steps">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          </button>
          <button type="button" className="np-action-icon" aria-label="History">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
          </button>
          <button type="button" className="np-action-icon" aria-label="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
          </button>
          <button type="button" className="np-action-icon" aria-label="More">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
          </button>
        </div>

        {isBrowserAgent && (
          <div className="node-panel-section">
            <div className="np-field-label">Vision type</div>
            <div className="np-select"><span className="np-select-left"><span className="select-icon select-icon-globe"><GlobeIcon /></span>Marks</span><span className="np-select-arrow" aria-hidden="true" /></div>

            <div className="np-field-label" style={{ marginTop: 12 }}>Starting URL</div>
            <div className="np-select np-select-url">{env?.startingUrl ?? 'Enter URL...'}<span className="np-select-arrow" aria-hidden="true" /></div>

            <div className="np-field-label" style={{ marginTop: 12 }}>Browser provider</div>
            <div className="np-select">Browserbase<span className="np-select-arrow" aria-hidden="true" /></div>

            <div className="np-field-label" style={{ marginTop: 12 }}>Proxy</div>
            <div className="np-select">No proxy<span className="np-select-arrow" aria-hidden="true" /></div>

            <div className="np-field-label" style={{ marginTop: 12 }}>Save auth cookies after run</div>
            <div style={{ marginTop: 6 }}>
              <label className="np-toggle">
                <input type="checkbox" defaultChecked={!!agent?.config?.saveAuthCookies} />
                <span className="np-toggle-switch" aria-hidden="true" />
                <span className="np-toggle-label">Save auth cookies</span>
              </label>
            </div>
          </div>
        )}

        <div className="node-panel-section">
          <div className="np-field-label">Model</div>
          <div className="np-select">{model}<span className="np-select-arrow" aria-hidden="true" /></div>
          {!isFileAgent && (
            <>
              <div className="np-subfield-group">
                <div className="np-field-label">Reasoning effort</div>
                <div className="np-select">Auto<span className="np-select-arrow" aria-hidden="true" /></div>
              </div>
            </>
          )}
        </div>

        {!isFileAgent && maxMin !== null && (
          <div className="node-panel-section">
            <div className="np-field-label">Max duration</div>
            <div className="np-duration-row">
              <div className="np-num-box np-num-box-sm">{maxMin}</div>
              <div className="np-unit-pill">minutes <span className="np-select-arrow" aria-hidden="true" /></div>
            </div>
          </div>
        )}

        {!isFileAgent && tools.length > 0 && (
          <div className="node-panel-section">
            <div className="np-field-label">Tools</div>
            <div className="np-chips">
              {tools.map((t) => <ToolChip key={t} name={t} />)}
              <span className="np-chip np-chip-add" aria-hidden="true">+</span>
            </div>
            {maxToolCalls != null && (
              <div className="np-subfield-group">
                <div className="np-field-label">Max tool calls</div>
                <div className="np-num-box np-num-box-sm">{maxToolCalls}</div>
              </div>
            )}
          </div>
        )}

        {!isFileAgent && (
          <div className="node-panel-section">
            <div className="np-field-label">Queueable agents</div>
            <div className="np-chips">
              {queueableIds.map((id) => {
                const a = agentById?.get(id)
                const v = a ? agentVariant(a) : 'browser'
                const c = VARIANT_COLORS[v]
                return (
                  <span key={id} className="np-queue-chip" style={{ background: c.bg, color: c.icon }}>
                    <span className="np-queue-chip-icon"><NodeIcon variant={v} /></span>
                    {a?.name ?? id}
                    <span className="np-chip-close" aria-hidden="true">×</span>
                  </span>
                )
              })}
              <span className="np-chip np-chip-add" aria-hidden="true">+</span>
            </div>
          </div>
        )}

        <div className="node-panel-section">
          <div className="np-field-label">{isFileAgent ? 'Files' : 'Inputs'}</div>
          <div className="np-chips">
            {inputProps.map(([key, schema]) => (
              <FieldChip key={key} name={key} schema={schema} mode={isFileAgent ? 'file' : 'variable'} />
            ))}
            <span className="np-chip np-chip-add" aria-hidden="true">+</span>
          </div>
        </div>

        <div className="node-panel-section">
          <div className="np-field-label">Outputs</div>
          <div className="np-chips">
            {outputProps.map(([key, schema]) => (
              <FieldChip key={key} name={key} schema={schema} />
            ))}
            <span className="np-chip np-chip-add" aria-hidden="true">+</span>
          </div>
        </div>

        {!isFileAgent && (
          <div className="node-panel-section">
            <div
              className="np-instructions-header"
              onClick={() => setStepsOpen((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setStepsOpen((v) => !v)}
            >
              <div className="np-field-label" style={{ marginBottom: 0 }}>Instructions</div>
              <span className="np-steps-count">{commands.length} steps</span>
            </div>
            {stepsOpen && commands.map((cmd, i) => (
              <CommandStep key={cmd.id ?? i} cmd={cmd} index={i} agentById={agentById} />
            ))}
            <button type="button" className="np-add-step" aria-label="Add step">+</button>
          </div>
        )}

      </div>
    </div>
  )
}

function AutomationCanvas({ automation, topOffset = 68, leftOffset = 240, onClose }) {
  const PANEL_W = 560
  const availableW = typeof window !== 'undefined' ? window.innerWidth - leftOffset - PANEL_W : 800
  const availableH = typeof window !== 'undefined' ? window.innerHeight - topOffset : 600

  const { nodes: initialNodes, edges } = buildLayout(automation, availableW, availableH)
  const agentById = new Map((automation?.agents ?? []).map((a) => [a.id, a]))

  const [positions, setPositions] = useState(() => {
    const map = {}
    for (const n of initialNodes) map[n.id] = { ...n.pos }
    return map
  })
  const [selectedId, setSelectedId] = useState(null)

  const dragRef = useRef(null)
  const mouseDownPos = useRef(null)

  // Shrink the embedded Magical react-flow canvas to make room for the panel
  useEffect(() => {
    const el = document.querySelector('[data-panel-group]')
    if (!el) return
    el.style.transition = 'padding-right 0.25s ease'
    el.style.boxSizing = 'border-box'
    el.style.paddingRight = selectedId ? `${PANEL_W}px` : '0px'
  }, [selectedId])

  // When panel opens, shift nodes left so none are clipped by the narrowed canvas
  useEffect(() => {
    if (!selectedId) return
    const canvasW = window.innerWidth - leftOffset - PANEL_W
    setPositions((prev) => {
      const maxRight = Math.max(...Object.values(prev).map((p) => p.x + NODE_W))
      if (maxRight <= canvasW) return prev
      const shift = maxRight - canvasW + PAD_X
      const next = {}
      for (const [id, pos] of Object.entries(prev)) {
        next[id] = { x: Math.max(0, pos.x - shift), y: pos.y }
      }
      return next
    })
  }, [selectedId, leftOffset])

  // Reset on unmount
  useEffect(() => {
    return () => {
      const el = document.querySelector('[data-panel-group]')
      if (el) {
        el.style.paddingRight = ''
        el.style.transition = ''
        el.style.boxSizing = ''
      }
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current) return
      const { id, startX, startY, origX, origY } = dragRef.current
      setPositions((prev) => ({
        ...prev,
        [id]: { x: origX + e.clientX - startX, y: origY + e.clientY - startY },
      }))
    }
    const onMouseUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const onNodeMouseDown = (e, nodeId) => {
    e.preventDefault()
    e.stopPropagation()
    mouseDownPos.current = { x: e.clientX, y: e.clientY }
    const pos = positions[nodeId]
    dragRef.current = { id: nodeId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }

  const onNodeMouseUp = (e, nodeId) => {
    const down = mouseDownPos.current
    if (down) {
      const dx = Math.abs(e.clientX - down.x)
      const dy = Math.abs(e.clientY - down.y)
      // treat as click if movement < 5px
      if (dx < 5 && dy < 5) {
        setSelectedId((prev) => (prev === nodeId ? null : nodeId))
      }
    }
    mouseDownPos.current = null
  }

  const edgePath = (edge) => {
    const sp = positions[edge.from]
    const tp = positions[edge.to]
    if (!sp || !tp) return null
    const x1 = sp.x + NODE_W / 2
    const y1 = sp.y + NODE_H
    const x2 = tp.x + NODE_W / 2
    const y2 = tp.y
    const midY = (y1 + y2) / 2
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
  }

  const selectedAgent = selectedId ? agentById.get(selectedId) : null
  const selectedNode = selectedId ? initialNodes.find((n) => n.id === selectedId) : null
  const selectedVariant = selectedNode ? nodeVariant(selectedNode) : null

  return (
    <>
      <div
        className="automation-canvas-layer"
        style={{ top: `${topOffset}px`, left: `${leftOffset}px`, right: selectedId ? `${PANEL_W}px` : 0, bottom: 0 }}
        onClick={() => setSelectedId(null)}
      >
        <svg
          className="automation-canvas-svg"
          style={{ width: '100%', height: '100%' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          {edges.map((edge, i) => {
            const d = edgePath(edge)
            if (!d) return null
            return (
              <path
                key={`${edge.from}-${edge.to}-${edge.dashed}-${i}`}
                d={d}
                className={`automation-edge${edge.dashed ? ' automation-edge-dashed' : ''}`}
              />
            )
          })}
        </svg>

        {initialNodes.map((node) => {
          const variant = nodeVariant(node)
          const colors = VARIANT_COLORS[variant]
          const pos = positions[node.id] ?? node.pos
          const isSelected = node.id === selectedId
          return (
            <div
              key={node.id}
              className={`automation-node${isSelected ? ' automation-node-selected' : ''}`}
              style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }}
              onMouseDown={(e) => onNodeMouseDown(e, node.id)}
              onMouseUp={(e) => onNodeMouseUp(e, node.id)}
              onClick={(e) => e.stopPropagation()}
            >
              <span
                className="automation-node-icon"
                style={{ background: colors.bg, color: colors.icon }}
              >
                <NodeIcon variant={variant} />
              </span>
              <span className="automation-node-label">{node.name}</span>
            </div>
          )
        })}

        <button
          type="button"
          className="automation-canvas-close"
          onClick={(e) => { e.stopPropagation(); onClose() }}
          aria-label="Close preview"
        >
          ×
        </button>
      </div>

      {selectedAgent && selectedVariant && (
        <div
          className="node-panel-sidebar"
          style={{ top: `${topOffset}px`, width: `${PANEL_W}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <NodePanel
            agent={selectedAgent}
            variant={selectedVariant}
            agentById={agentById}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </>
  )
}

export default AutomationCanvas
