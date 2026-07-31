import { useEffect, useState } from 'react'

const EMPTY_CONFIG = {
  llm: { provider: 'ollama', model: '', temperature: 0.75 },
  topics: { focus: [] },
  feeds: [],
  rag: { n_queries: 3, n_results: 12, chunk_size: 150, overlap: 30, max_chunks_per_article: 2, articles_per_feed: 6 },
  audio: { language: 'en', tts_backend: 'auto' },
}

function ConfigPanel({ onSaved }) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState(EMPTY_CONFIG)
  const [topicsText, setTopicsText] = useState('')
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const [newFeedSource, setNewFeedSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  const loadConfig = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      setConfig(data)
      setTopicsText((data.topics?.focus || []).join(', '))
    } catch {
      setStatus({ type: 'error', text: 'Could not load config.toml' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const updateField = (section, field, value) => {
    setConfig({ ...config, [section]: { ...config[section], [field]: value } })
  }

  const addFeed = () => {
    if (!newFeedUrl.trim()) return
    setConfig({
      ...config,
      feeds: [...config.feeds, { url: newFeedUrl.trim(), source: newFeedSource.trim() || newFeedUrl.trim() }],
    })
    setNewFeedUrl('')
    setNewFeedSource('')
  }

  const removeFeed = (index) => {
    setConfig({ ...config, feeds: config.feeds.filter((_, i) => i !== index) })
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    const payload = {
      ...config,
      topics: { focus: topicsText.split(',').map((t) => t.trim()).filter(Boolean) },
    }
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ type: 'error', text: data.error || 'Failed to save config.' })
      } else {
        setStatus({ type: 'ok', text: 'Saved to config.toml ✓' })
        onSaved?.(payload)
      }
    } catch {
      setStatus({ type: 'error', text: 'Could not reach the backend.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel config-panel">
      <div className="config-panel-header" onClick={() => setOpen(!open)}>
        <h2>⚙️ Settings {open ? '▲' : '▼'}</h2>
      </div>

      {open && (
        <div className="config-panel-body">
          {loading && <p>Loading config.toml…</p>}

          {!loading && (
            <>
              <div className="config-section">
                <h3>LLM</h3>
                <div className="config-grid">
                  <label>
                    Provider
                    <select
                      value={config.llm.provider}
                      onChange={(e) => updateField('llm', 'provider', e.target.value)}
                    >
                      <option value="ollama">ollama</option>
                      <option value="openai">openai</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input
                      type="text"
                      value={config.llm.model}
                      onChange={(e) => updateField('llm', 'model', e.target.value)}
                    />
                  </label>
                  <label>
                    Temperature
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="2"
                      value={config.llm.temperature}
                      onChange={(e) => updateField('llm', 'temperature', parseFloat(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <h3>Topics</h3>
                <input
                  type="text"
                  className="config-wide-input"
                  value={topicsText}
                  onChange={(e) => setTopicsText(e.target.value)}
                  placeholder="AI, machine learning, React, JavaScript"
                />
              </div>

              <div className="config-section">
                <h3>RAG parameters</h3>
                <div className="config-grid">
                  <label>
                    n_queries
                    <input
                      type="number"
                      min="1"
                      value={config.rag.n_queries}
                      onChange={(e) => updateField('rag', 'n_queries', parseInt(e.target.value, 10))}
                    />
                  </label>
                  <label>
                    n_results
                    <input
                      type="number"
                      min="1"
                      value={config.rag.n_results}
                      onChange={(e) => updateField('rag', 'n_results', parseInt(e.target.value, 10))}
                    />
                  </label>
                  <label>
                    chunk_size
                    <input
                      type="number"
                      min="20"
                      value={config.rag.chunk_size}
                      onChange={(e) => updateField('rag', 'chunk_size', parseInt(e.target.value, 10))}
                    />
                  </label>
                  <label>
                    overlap
                    <input
                      type="number"
                      min="0"
                      value={config.rag.overlap}
                      onChange={(e) => updateField('rag', 'overlap', parseInt(e.target.value, 10))}
                    />
                  </label>
                  <label>
                    max_chunks_per_article
                    <input
                      type="number"
                      min="1"
                      value={config.rag.max_chunks_per_article}
                      onChange={(e) => updateField('rag', 'max_chunks_per_article', parseInt(e.target.value, 10))}
                    />
                  </label>
                  <label>
                    articles_per_feed
                    <input
                      type="number"
                      min="1"
                      value={config.rag.articles_per_feed}
                      onChange={(e) => updateField('rag', 'articles_per_feed', parseInt(e.target.value, 10))}
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <h3>Audio</h3>
                <div className="config-grid">
                  <label>
                    Language
                    <input
                      type="text"
                      value={config.audio.language}
                      onChange={(e) => updateField('audio', 'language', e.target.value)}
                    />
                  </label>
                  <label>
                    TTS backend
                    <input
                      type="text"
                      value={config.audio.tts_backend}
                      onChange={(e) => updateField('audio', 'tts_backend', e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="config-section">
                <h3>Feeds</h3>
                <ul className="feed-list">
                  {config.feeds.map((f, i) => (
                    <li key={i}>
                      <span>{f.source} — {f.url}</span>
                      <button type="button" className="feed-remove-btn" onClick={() => removeFeed(i)}>✕</button>
                    </li>
                  ))}
                </ul>
                <div className="feed-add-row">
                  <input
                    type="text"
                    placeholder="Feed URL"
                    value={newFeedUrl}
                    onChange={(e) => setNewFeedUrl(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Source name"
                    value={newFeedSource}
                    onChange={(e) => setNewFeedSource(e.target.value)}
                  />
                  <button type="button" onClick={addFeed}>+ Add feed</button>
                </div>
              </div>

              <div className="config-actions">
                <button className="run-btn" disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save config.toml'}
                </button>
                {status && (
                  <span className={status.type === 'error' ? 'error' : 'config-status-ok'}>{status.text}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default ConfigPanel
