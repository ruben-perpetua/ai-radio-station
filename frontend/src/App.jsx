import { useEffect, useRef, useState } from 'react'
import './App.css'
import ConfigPanel from './ConfigPanel.jsx'

const MODULE_STEPS = [
  { key: 'Module 6', label: '6 · MCP Tool Registry' },
  { key: 'Module 1', label: '1 · LLM Connection' },
  { key: 'Module 3', label: '3 · Vector Database' },
  { key: 'Modules 5 + 6', label: '5+6 · Agentic News Collection' },
  { key: 'Modules 4 + 1', label: '4+1 · RAG Script Generation' },
  { key: 'Module 2', label: '2 · Fine-Tuning Status' },
  { key: 'TTS', label: 'TTS · Text-to-Speech' },
]

function currentStepIndex(logs) {
  let idx = -1
  for (const line of logs) {
    MODULE_STEPS.forEach((step, i) => {
      if (line.includes(`[${step.key}]`)) idx = i
    })
  }
  return idx
}

function App() {
  const [options, setOptions] = useState({
    mock: true,
    no_audio: false,
    reset_db: false,
    skip_fetch: false,
    provider: '',
    model: '',
  })
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState('generate')
  const [logs, setLogs] = useState([])
  const [script, setScript] = useState(null)
  const [ragScript, setRagScript] = useState(null)
  const [noRagScript, setNoRagScript] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const logEndRef = useRef(null)

  const pollStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setRunning(data.running)
      setMode(data.mode || 'generate')
      setLogs(data.logs || [])
      setScript(data.script)
      setRagScript(data.rag_script)
      setNoRagScript(data.no_rag_script)
      setAudioUrl(data.audio_url)
      setError(data.error)
      if (!data.running && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    } catch {
      // backend not reachable yet — keep polling
    }
  }

  const resetOutputs = () => {
    setError(null)
    setScript(null)
    setRagScript(null)
    setNoRagScript(null)
    setAudioUrl(null)
    setLogs([])
  }

  const startRun = async () => {
    resetOutputs()
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
    if (res.status === 409) {
      setError('A run is already in progress.')
      return
    }
    setMode('generate')
    setRunning(true)
    pollRef.current = setInterval(pollStatus, 800)
  }

  const startCompare = async () => {
    resetOutputs()
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mock: options.mock, provider: options.provider, model: options.model }),
    })
    if (res.status === 409) {
      setError('A run is already in progress.')
      return
    }
    setMode('compare')
    setRunning(true)
    pollRef.current = setInterval(pollStatus, 800)
  }

  useEffect(() => {
    pollStatus()
    return () => pollRef.current && clearInterval(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const activeStep = currentStepIndex(logs)

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎙️ Personal AI Tech Radio</h1>
        <p>Watch the pipeline run: agent → vector DB → RAG → LLM → audio.</p>
      </header>

      <ConfigPanel onSaved={() => {}} />

      <section className="panel controls">
        <h2>Run Options</h2>
        <div className="options-grid">
          <label>
            <input
              type="checkbox"
              checked={options.mock}
              onChange={(e) => setOptions({ ...options, mock: e.target.checked })}
            />
            Mock LLM (no Ollama needed)
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.skip_fetch}
              onChange={(e) => setOptions({ ...options, skip_fetch: e.target.checked })}
            />
            Skip RSS fetch (reuse vector store)
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.no_audio}
              onChange={(e) => setOptions({ ...options, no_audio: e.target.checked })}
            />
            Skip audio (text only)
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.reset_db}
              onChange={(e) => setOptions({ ...options, reset_db: e.target.checked })}
            />
            Reset vector store
          </label>
        </div>

        <div className="model-select-row">
          <label className="model-select-field">
            Provider
            <select
              value={options.provider}
              onChange={(e) => setOptions({ ...options, provider: e.target.value })}
            >
              <option value="">(use config.toml)</option>
              <option value="ollama">ollama</option>
              <option value="openai">openai</option>
            </select>
          </label>
          <label className="model-select-field">
            Model
            <input
              type="text"
              placeholder="(use config.toml)"
              value={options.model}
              onChange={(e) => setOptions({ ...options, model: e.target.value })}
            />
          </label>
        </div>

        <div className="run-btn-row">
          <button className="run-btn" disabled={running} onClick={startRun}>
            {running && mode === 'generate' ? 'Generating…' : '▶ Generate Episode'}
          </button>
          <button className="compare-btn" disabled={running} onClick={startCompare}>
            {running && mode === 'compare' ? 'Comparing…' : '⚖ Compare RAG vs No-RAG'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h2>Pipeline Progress</h2>
        <ol className="steps">
          {MODULE_STEPS.map((step, i) => (
            <li
              key={step.key}
              className={
                i < activeStep ? 'done' : i === activeStep ? (running ? 'active' : 'done') : ''
              }
            >
              {step.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <h2>Live Logs</h2>
        <div className="log-console">
          {logs.length === 0 && <div className="log-placeholder">No logs yet — click Generate Episode.</div>}
          {logs.map((line, i) => (
            <div key={i} className="log-line">{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>

      {script && mode === 'generate' && (
        <section className="panel">
          <h2>Generated Script</h2>
          <pre className="script-box">{script}</pre>
        </section>
      )}

      {mode === 'compare' && (ragScript || noRagScript) && (
        <section className="panel">
          <h2>RAG vs No-RAG Comparison</h2>
          <div className="compare-grid">
            <div className="compare-column">
              <h3>✅ With RAG (grounded in retrieved articles)</h3>
              <pre className="script-box">{ragScript || '(waiting…)'}</pre>
            </div>
            <div className="compare-column">
              <h3>⚠️ Without RAG (from the model's own knowledge)</h3>
              <pre className="script-box">{noRagScript || '(waiting…)'}</pre>
            </div>
          </div>
        </section>
      )}

      {audioUrl && (
        <section className="panel">
          <h2>Audio Episode</h2>
          <audio controls src={audioUrl} className="audio-player" />
        </section>
      )}
    </div>
  )
}

export default App

