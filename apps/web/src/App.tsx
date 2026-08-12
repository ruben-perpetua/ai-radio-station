import { useState } from "react";
import { DebugPanel } from "./components/DebugPanel";
import { RadioPanel } from "./components/RadioPanel";
import "./App.css";

type Tab = "radio" | "debug";

function App() {
  const [tab, setTab] = useState<Tab>("radio");

  return (
    <main className="app">
      <header className="app-header">
        <h1>Tech Radio</h1>
        <nav className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "radio"}
            className={tab === "radio" ? "tab active" : "tab"}
            onClick={() => setTab("radio")}
          >
            Radio
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "debug"}
            className={tab === "debug" ? "tab active" : "tab"}
            onClick={() => setTab("debug")}
          >
            Debug
          </button>
        </nav>
      </header>

      {/* Both panels stay mounted; we only hide the inactive one so switching to
          Debug never interrupts playback in the Radio tab. */}
      <section hidden={tab !== "radio"} className="tab-panel">
        <RadioPanel />
      </section>
      <section hidden={tab !== "debug"} className="tab-panel">
        <DebugPanel />
      </section>
    </main>
  );
}

export default App;
