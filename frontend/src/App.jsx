import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [markup, setMarkup] = useState('')
  const [error, setError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [taskDescription, setTaskDescription] = useState('')
  const [proposedPlan, setProposedPlan] = useState([])

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleProposePlan = () => {
    const cleanDescription = taskDescription.trim()
    if (!cleanDescription) {
      setProposedPlan([])
      return
    }

    setProposedPlan([
      'Clarify the trigger and desired final output for this automation.',
      'Map each required step, including tools, systems, and data needed.',
      'Add validations and fallback handling for edge cases.',
      'Generate a runnable automation draft and prepare a test checklist.',
    ])
  }

  const handleDenyPlan = () => {
    setProposedPlan([])
  }

  const handleAcceptPlan = () => {
    setIsModalOpen(false)
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
    if (!markup) {
      return
    }

    const centerSlot = document.querySelector(
      'div[class*="min-h-[68px]"] div[class*="left-1/2"][class*="top-1/2"]',
    )

    if (!centerSlot) {
      return
    }

    centerSlot.replaceChildren()

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copilot-topbar-title copilot-topbar-cta'
    button.textContent = 'Get started'
    button.addEventListener('click', () => setIsModalOpen(true))
    centerSlot.appendChild(button)
  }, [markup, isModalOpen])

  useEffect(() => {
    if (!isModalOpen) {
      return
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isModalOpen])

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

      {isModalOpen && (
        <div className="copilot-modal-backdrop" onClick={handleCloseModal}>
          <section
            className="copilot-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="automation-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="copilot-modal-header">
              <h2 id="automation-modal-title">Describe what you want to automate</h2>
              <button type="button" className="copilot-close-btn" onClick={handleCloseModal}>
                ×
              </button>
            </header>

            <div className="copilot-modal-section">
              <h3>Task description</h3>
              <p>Tell the agent your goal, systems involved, and expected outcome.</p>
              <textarea
                className="copilot-textarea"
                placeholder="Example: When a new lead is added in HubSpot, enrich the contact, create a Slack summary, and open a follow-up task in Asana."
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
              />
            </div>

            <div className="copilot-modal-section">
              <h3>Proposed plan</h3>
              <p>Review the plan before you choose to accept or deny it.</p>

              {proposedPlan.length === 0 ? (
                <div className="copilot-empty-plan">
                  No plan proposed yet. Click Propose plan to generate one.
                </div>
              ) : (
                <ol className="copilot-plan-list">
                  {proposedPlan.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </div>

            <footer className="copilot-modal-footer">
              <button type="button" className="copilot-secondary-btn" onClick={handleDenyPlan}>
                Deny plan
              </button>
              <button type="button" className="copilot-secondary-btn" onClick={handleProposePlan}>
                Propose plan
              </button>
              <button
                type="button"
                className="copilot-primary-btn"
                onClick={handleAcceptPlan}
                disabled={proposedPlan.length === 0}
              >
                Accept plan
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}

export default App
