import './App.css'

function App() {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Super CD Search</h1>
      </header>
      <main className="app-main">
        <aside className="left-panel">
          <div className="panel-header">
            <h2>Input</h2>
          </div>
          <div className="panel-content">
            <p className="placeholder-text">
              Enter up to 10 CD catalog numbers to search across Discogs, eBay, Kojima Rokuon, and Mercari.
            </p>
          </div>
        </aside>
        <section className="right-panel">
          <div className="panel-header">
            <h2>Results</h2>
          </div>
          <div className="panel-content">
            <p className="placeholder-text">
              Search results will appear here.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
