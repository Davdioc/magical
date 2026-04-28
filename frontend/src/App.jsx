import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import AutomationCanvas from './AutomationCanvas'
import './App.css'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const stripXmlBlock = (text, tag) => {
  const open = text.indexOf(`<${tag}>`)
  if (open === -1) return text
  const close = text.indexOf(`</${tag}>`, open)
  if (close === -1) return text.slice(0, open).replace(/\s+$/, '')
  const prefix = text.slice(0, open)
  const suffix = text.slice(close + `</${tag}>`.length)
  return stripXmlBlock((prefix + suffix).replace(/\s+$/, ''), tag)
}

const stripAutomation = (text) => stripXmlBlock(stripXmlBlock(text, 'automation'), 'clarify')

const tryParseJson = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const extractAutomation = (text) => {
  const match = text.match(/<automation>([\s\S]*?)<\/automation>/)
  if (!match) {
    if (text.includes('<automation>')) {
      console.warn('[automation] Opening tag found but no closing tag yet — still streaming?')
    }
    return null
  }
  const inner = match[1].trim()

  // Tolerate the model wrapping JSON in markdown fences inside the tags.
  const fenced = inner.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // Last resort: slice from the first { to the matching last } to drop any
  // stray prose the model emitted alongside the JSON.
  const firstBrace = fenced.indexOf('{')
  const lastBrace = fenced.lastIndexOf('}')
  const sliced = firstBrace !== -1 && lastBrace > firstBrace
    ? fenced.slice(firstBrace, lastBrace + 1)
    : fenced

  const parsed = tryParseJson(fenced) ?? tryParseJson(sliced)
  if (parsed) {
    console.info('[automation] Parsed OK — agents:', parsed?.agents?.length ?? 'unknown')
    return parsed
  }

  console.error('[automation] JSON.parse failed for both fenced and sliced variants')
  console.error('[automation] Raw (first 500 chars):', inner.slice(0, 500))
  console.error('[automation] Raw (last 200 chars):', inner.slice(-200))
  return null
}

const downloadAutomation = (obj) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'automation.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const [markup, setMarkup] = useState('')
  const [error, setError] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isExpanded, setIsExpanded] = useState(false)
  const [topbarOffset, setTopbarOffset] = useState(68)
  const [chatInput, setChatInput] = useState('')
  const chatInputRef = useRef(null)
  const messagesRef = useRef(null)
  const shouldAutoScrollRef = useRef(true)
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hi! I am your automation assistant. Describe what you want to automate, the site(s) involved, what triggers the work, the fields to fill, and I will design a Magical automation for you.',
    },
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentAutomation, setCurrentAutomation] = useState(null)
  const [automationVersion, setAutomationVersion] = useState(0)
  const [isBuilt, setIsBuilt] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  // Active clarify state — drives the step-by-step card in the footer
  const [clarifyQuestions, setClarifyQuestions] = useState(null) // {q, options}[] | null
  const [clarifyStep, setClarifyStep] = useState(0)
  const [clarifyCollected, setClarifyCollected] = useState([]) // string[] answers so far
  const [clarifyCustom, setClarifyCustom] = useState('')

  const advanceClarify = (answer) => {
    const next = [...clarifyCollected, answer]
    if (clarifyStep + 1 < clarifyQuestions.length) {
      setClarifyCollected(next)
      setClarifyStep(s => s + 1)
      setClarifyCustom('')
    } else {
      const text = next.map((a, i) => `${i + 1}. ${a}`).join('\n')
      setClarifyQuestions(null)
      setClarifyStep(0)
      setClarifyCollected([])
      setClarifyCustom('')
      handleSendMessage(text)
    }
  }

  const handleSendMessage = async (overrideText) => {
    const source = typeof overrideText === 'string' ? overrideText : chatInput
    const message = source.trim()
    if (!message || isStreaming) {
      return
    }

    const updatedHistory = [...chatMessages, { role: 'user', content: message }]
    setChatMessages([...updatedHistory, { role: 'assistant', content: '' }])
    setChatInput('')
    setIsStreaming(true)

    let assistantText = ''
    let automationFound = false
    const writeAssistant = (text) => {
      setChatMessages((previous) => {
        const next = previous.slice()
        next[next.length - 1] = { role: 'assistant', content: text }
        return next
      })
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedHistory }),
      })
      if (!response.ok || !response.body) {
        throw new Error(`Request failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })

        const normalized = buffer.replace(/\r\n/g, '\n')
        const frames = normalized.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const line = frame.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            done = true
            break
          }
          let event
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }
          if (event.type === 'text' && typeof event.content === 'string') {
            assistantText += event.content
            writeAssistant(assistantText)
            if (!automationFound && assistantText.includes('</automation>')) {
              const automation = extractAutomation(assistantText)
              if (automation) {
                automationFound = true
                setCurrentAutomation(automation)
                setAutomationVersion((v) => v + 1)
              }
            }
          } else if (event.type === 'clarify' && Array.isArray(event.content)) {
            setClarifyQuestions(event.content)
            setClarifyStep(0)
            setClarifyCollected([])
            setClarifyCustom('')
          } else if (event.type === 'error') {
            assistantText += `\n\n[Error: ${event.content}]`
            writeAssistant(assistantText)
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      assistantText = assistantText
        ? `${assistantText}\n\n[Error: ${detail}]`
        : `Error: ${detail}`
      writeAssistant(assistantText)
    } finally {
      // Safety net: if streaming finished but per-chunk extraction never
      // succeeded (e.g. JSON.parse failed mid-stream and was never retried),
      // make one final attempt against the fully-assembled text.
      if (!automationFound && assistantText.includes('</automation>')) {
        const automation = extractAutomation(assistantText)
        if (automation) {
          setCurrentAutomation(automation)
          setAutomationVersion((v) => v + 1)
        }
      }
      setIsStreaming(false)
    }
  }

  useEffect(() => {
    let isActive = true
    const previousTitle = document.title
    const previousBodyClass = document.body.className
    const injectedNodes = []

    const injectHeadNodes = (doc) => {
      const headNodes = doc.head.querySelectorAll('style, link[rel="stylesheet"]')
      headNodes.forEach((node) => {
        const cloned = node.cloneNode(true)
        cloned.setAttribute('data-magical-injected', 'true')
        document.head.appendChild(cloned)
        injectedNodes.push(cloned)
      })
    }

    const loadTransferredPage = async () => {
      try {
        const response = await fetch('/magicalPlatform.html')
        if (!response.ok) {
          throw new Error('Failed to load transferred HTML.')
        }

        const rawHtml = await response.text()
        const parsed = new DOMParser().parseFromString(rawHtml, 'text/html')

        if (!isActive) {
          return
        }

        injectHeadNodes(parsed)
        document.title = parsed.title || previousTitle
        document.body.className = parsed.body.className || previousBodyClass
        setMarkup(parsed.body.innerHTML)
      } catch (err) {
        if (!isActive) {
          return
        }

        setError(err instanceof Error ? err.message : 'Unable to load page content.')
      }
    }

    loadTransferredPage()

    return () => {
      isActive = false
      document.title = previousTitle
      document.body.className = previousBodyClass
      injectedNodes.forEach((node) => node.remove())
    }
  }, [])

  useEffect(() => {
    if (!isChatOpen) {
      return
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsChatOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isChatOpen])

  useEffect(() => {
    if (!menuOpen) return
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [menuOpen])

  useEffect(() => {
    if (isChatOpen) {
      shouldAutoScrollRef.current = true
    }
  }, [isChatOpen])

  useEffect(() => {
    const input = chatInputRef.current
    if (!input) {
      return
    }

    input.style.height = 'auto'
    const maxHeight = 140
    const nextHeight = Math.min(input.scrollHeight, maxHeight)
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [chatInput, isChatOpen])

  const onMessagesScroll = () => {
    const el = messagesRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom <= 60
  }

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    if (!shouldAutoScrollRef.current) return

    const behavior = isStreaming ? 'auto' : 'smooth'
    try {
      el.scrollTo({ top: el.scrollHeight, behavior })
    } catch {
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages, isStreaming, isChatOpen])

  useEffect(() => {
    if (!markup) {
      return
    }

    const getTopbarElement = () =>
      document.querySelector('div[class*="min-h-[68px]"][class*="border-b"]')

    let topbar = getTopbarElement()

    const updateOffset = () => {
      if (!topbar) {
        topbar = getTopbarElement()
      }

      if (!topbar) {
        setTopbarOffset(68)
        return
      }

      const rect = topbar.getBoundingClientRect()
      const measured = Math.round(rect.height)
      setTopbarOffset(Number.isFinite(measured) && measured > 0 ? measured : 68)
    }

    updateOffset()

    const observer = new ResizeObserver(updateOffset)
    if (topbar) {
      observer.observe(topbar)
    }

    window.addEventListener('resize', updateOffset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateOffset)
    }
  }, [markup])

  if (error) {
    return <main className="loader-state">{error}</main>
  }

  if (!markup) {
    return <main className="loader-state">Loading transferred page...</main>
  }

  return (
    <>
      <main
        className="transferred-page"
        dangerouslySetInnerHTML={{ __html: markup }}
      />

      <button
        type="button"
        className="copilot-ai-launcher"
        aria-label={isChatOpen ? 'Minimize chat' : 'Open AI assistant'}
        onClick={() => { setIsChatOpen(v => !v); setIsExpanded(false) }}
      >
        {isChatOpen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="4" ry="4" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
            <path d="M12 8.4l1.1 2.5 2.5 1.1-2.5 1.1-1.1 2.5-1.1-2.5-2.5-1.1 2.5-1.1z" />
          </svg>
        )}
      </button>

      {isChatOpen && (
        <aside
          className="copilot-chat-panel"
          role="dialog"
          aria-label="AI assistant chat"
          style={isExpanded ? {
            top: `${topbarOffset +10}px`,
            bottom: 'auto',
            height: `calc(98vh - ${topbarOffset + 70}px)`,
            width: 'min(600px, 90vw)',
          } : {
            top: 'auto',
            bottom: '88px',
            height: '690px',
          }}
        >
          <header className="copilot-chat-header">
            <button type="button" className="copilot-chat-back" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="copilot-chat-agent">
              <img src="/sam-avatar.jpg" alt="Sam" className="copilot-chat-avatar" />
              <div className="copilot-chat-agent-text">
                <span className="copilot-chat-agent-name">Sam</span>
                <span className="copilot-chat-agent-sub">AI Assistant</span>
              </div>
            </div>
            <div className="copilot-chat-header-end">
              <div className="copilot-menu-wrapper" ref={menuRef}>
                <button
                  type="button"
                  className="copilot-chat-menu-btn"
                  aria-label="More options"
                  onClick={() => setMenuOpen(v => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="19" cy="12" r="1.5" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="copilot-chat-dropdown">
                    {isExpanded ? (
                      <button
                        type="button"
                        className="copilot-dropdown-item"
                        onClick={() => { setIsExpanded(false); setMenuOpen(false) }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                        </svg>
                        Collapse window
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="copilot-dropdown-item"
                        onClick={() => { setIsExpanded(true); setMenuOpen(false) }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                        Expand window
                      </button>
                    )}
                    <button type="button" className="copilot-dropdown-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
                      </svg>
                      Download transcript
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="copilot-chat-close"
                aria-label="Close chat"
                onClick={() => setIsChatOpen(false)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </header>

          <section ref={messagesRef} onScroll={onMessagesScroll} className="copilot-chat-messages">
            <p className="copilot-chat-subtitle">Ask for help automating your workflow</p>
            {chatMessages.map((message, index) => {
              const display =
                message.role === 'assistant'
                  ? stripAutomation(message.content)
                  : message.content
              if (!display && message.role === 'assistant' && index === chatMessages.length - 1 && isStreaming) {
                return (
                  <article
                    key={`${message.role}-${index}`}
                    className="copilot-message copilot-message-assistant copilot-message-thinking"
                  >
                    <span className="copilot-thinking-shimmer">Thinking</span>
                  </article>
                )
              }
              if (!display) return null

              return (
                <article
                  key={`${message.role}-${index}`}
                  className={`copilot-message copilot-message-${message.role}`}
                >
                  <div
                    className="copilot-message-markdown"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(marked.parse(display)),
                    }}
                  />
                  {message.role === 'assistant' && (
                    <div className="copilot-message-attribution">Sam · AI Agent · Just now</div>
                  )}
                </article>
              )
            })}
          </section>

          {currentAutomation && (
            <div className="copilot-action-bar">
              <button
                type="button"
                className="copilot-action-details"
                onClick={() => downloadAutomation(currentAutomation)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" />
                </svg>
                Download
              </button>
              <button
                type="button"
                className="copilot-action-deploy"
                onClick={() => setIsBuilt(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" />
                  <path d="M7 12h4m4-5.8-4 4M15 17l-4-3.5" />
                </svg>
                Build
              </button>
            </div>
          )}

          {clarifyQuestions && clarifyStep < clarifyQuestions.length ? (
            <div className="copilot-clarify-card">
              <div className="copilot-clarify-card-header">
                <span className="copilot-clarify-card-title">
                  {clarifyQuestions[clarifyStep].q}
                </span>
                {clarifyQuestions.length > 1 && (
                  <span className="copilot-clarify-card-progress">
                    {clarifyStep + 1}/{clarifyQuestions.length}
                  </span>
                )}
              </div>
              <div className="copilot-clarify-card-options">
                {clarifyQuestions[clarifyStep].options.slice(0, -1).map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="copilot-clarify-card-option"
                    onClick={() => advanceClarify(opt)}
                  >
                    <span className="copilot-clarify-card-num">{i + 1}</span>
                    <span className="copilot-clarify-card-opt-text">{opt}</span>
                  </button>
                ))}
                <div className="copilot-clarify-card-custom-row">
                  <span className="copilot-clarify-card-num copilot-clarify-card-num-pencil">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M11 2l3 3-8 8H3v-3L11 2z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    className="copilot-clarify-card-custom-input"
                    placeholder={clarifyQuestions[clarifyStep].options.at(-1)}
                    value={clarifyCustom}
                    onChange={(e) => setClarifyCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && clarifyCustom.trim()) {
                        advanceClarify(clarifyCustom.trim())
                      }
                    }}
                  />
                  {clarifyCustom.trim() ? (
                    <button
                      type="button"
                      className="copilot-clarify-card-skip"
                      onClick={() => advanceClarify(clarifyCustom.trim())}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="copilot-clarify-card-skip"
                      onClick={() => advanceClarify('—')}
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <footer className="copilot-chat-input-row">
              <textarea
                ref={chatInputRef}
                className="copilot-chat-input"
                placeholder="Message..."
                value={chatInput}
                rows={1}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSendMessage()
                  }
                }}
                disabled={isStreaming}
              />
              <div className="copilot-chat-input-toolbar">
                <div className="copilot-toolbar-icons">
                  <button type="button" className="copilot-toolbar-icon" aria-label="Attach file" tabIndex={-1}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 16.41a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <button type="button" className="copilot-toolbar-icon" aria-label="Emoji" tabIndex={-1}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 13s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" />
                      <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </button>
                  <button type="button" className="copilot-toolbar-icon copilot-toolbar-gif" aria-label="GIF" tabIndex={-1}>
                    GIF
                  </button>
                  <button type="button" className="copilot-toolbar-icon" aria-label="Voice message" tabIndex={-1}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </button>
                </div>
                <button
                  type="button"
                  className={`copilot-chat-send${chatInput.trim() ? ' copilot-chat-send-active' : ''}`}
                  onClick={handleSendMessage}
                  aria-label="Send message"
                  disabled={isStreaming}
                >
                  <svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </footer>
          )}
        </aside>
      )}

      {isBuilt && currentAutomation && (
        <AutomationCanvas
          key={automationVersion}
          automation={currentAutomation}
          topOffset={topbarOffset}
          onClose={() => setIsBuilt(false)}
        />
      )}
    </>
  )
}

export default App
