import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [markup, setMarkup] = useState('')
  const [error, setError] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [topbarOffset, setTopbarOffset] = useState(68)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      text: 'Hi! I am your automation assistant. Describe what you want to automate and I will propose a step-by-step plan for your approval.',
    },
  ])

  const handleSendMessage = () => {
    const message = chatInput.trim()
    if (!message) {
      return
    }

    setChatMessages((previous) => [
      ...previous,
      { role: 'user', text: message },
      {
        role: 'assistant',
        text: 'Got it. I can draft a proposed automation plan with trigger, core steps, validation, and fallback logic. If you want, include any systems or tools you need this to run in.',
      },
    ])
    setChatInput('')
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

      {!isChatOpen && (
        <button
          type="button"
          className="copilot-ai-launcher"
          aria-label="Open AI assistant"
          onClick={() => setIsChatOpen(true)}
        >
          <span className="copilot-ai-launcher-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation" focusable="false">
              <rect x="5" y="5" width="14" height="14" rx="4" ry="4" />
              <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
              <path d="M12 8.4l1.1 2.5 2.5 1.1-2.5 1.1-1.1 2.5-1.1-2.5-2.5-1.1 2.5-1.1z" />
            </svg>
          </span>
        </button>
      )}

      {isChatOpen && (
        <aside
          className="copilot-chat-panel"
          role="dialog"
          aria-label="AI assistant chat"
          style={{
            top: `${topbarOffset}px`,
            height: `calc(100vh - ${topbarOffset}px)`,
          }}
        >
          <header className="copilot-chat-header">
            <div>
              <h2>Automation Assistant</h2>
            </div>
            <button
              type="button"
              className="copilot-chat-close"
              aria-label="Close chat"
              onClick={() => setIsChatOpen(false)}
            >
              ×
            </button>
          </header>

          <section className="copilot-chat-messages">
            {chatMessages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`copilot-message copilot-message-${message.role}`}
              >
                {message.text}
              </article>
            ))}
          </section>

          <footer className="copilot-chat-input-row">
            <input
              type="text"
              className="copilot-chat-input"
              placeholder="Describe what you want to automate..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSendMessage()
                }
              }}
            />
            <button
              type="button"
              className="copilot-chat-send"
              onClick={handleSendMessage}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
                <path d="M21.5 2.5 11 13" />
                <path d="M21.5 2.5 15 21.5l-4-8-8-4z" />
              </svg>
            </button>
          </footer>
        </aside>
      )}
    </>
  )
}

export default App
