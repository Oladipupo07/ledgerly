import { formatNgn } from "@/lib/money";

const observations = [
  { mark: "↗", title: "One invoice needs a follow-up", text: "Adeola Foods · 8 days overdue · Based on 1 open invoice", amount: 14500000, tone: "amber" },
  { mark: "•", title: "Supplier bill due this week", text: "Midas Packaging · Due Friday · Based on 1 recorded bill", amount: 6200000, tone: "blue" },
  { mark: "✓", title: "Your recorded cash increased", text: "Compared with the previous 30 days · 12 recorded entries", amount: 38500000, tone: "green" },
];

const rows = [
  ["Nov 05", "Client project · Adeola Foods", "Income", 25000000],
  ["Nov 04", "Workshop supplies", "Expense", -4850000],
  ["Nov 03", "Monthly workspace rent", "Expense", -12000000],
  ["Nov 02", "Website redesign · Kora Atelier", "Income", 18000000],
] as const;

export default function Home() {
  return <main className="shell">
    <aside className="sidebar">
      <a className="brand" href="#home"><span className="brand-mark">l</span> ledgerly</a>
      <div className="workspace"><span className="avatar">K</span><span><b>Kora Atelier</b><small>Business workspace</small></span><span className="chevron">⌄</span></div>
      <nav aria-label="Main navigation">
        <a className="nav-item active" href="#overview"><span>◫</span> Overview</a>
        <a className="nav-item" href="#transactions"><span>↕</span> Transactions</a>
        <a className="nav-item" href="#invoices"><span>▤</span> Invoices</a>
        <a className="nav-item" href="#customers"><span>♙</span> Customers</a>
        <a className="nav-item" href="#suppliers"><span>◇</span> Suppliers</a>
        <a className="nav-item" href="#cashflow"><span>⌁</span> Cash flow</a>
        <a className="nav-item" href="#reports"><span>▥</span> Reports</a>
      </nav>
      <div className="sidebar-bottom"><a className="nav-item" href="#settings"><span>⚙</span> Settings</a><div className="profile"><span className="avatar owner">AO</span><span><b>Amina Okafor</b><small>Owner</small></span><span className="chevron">•••</span></div></div>
    </aside>

    <section className="content" id="overview">
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark">l</span> ledgerly</div><div className="crumb">Kora Atelier <span>/</span> Overview</div><div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button" aria-label="Notifications">♧</button><button className="help">Help</button></div></header>
      <div className="page-wrap">
        <div className="heading-row"><div><p className="eyebrow">THURSDAY, 6 NOVEMBER 2026</p><h1>Good morning, Amina</h1><p className="subheading">Here’s what’s happening with your business money.</p></div><button className="primary">＋ <span>Add transaction</span></button></div>

        <div className="coverage"><span className="pulse"/> Your records are up to date through <b>5 November</b><span className="coverage-link">View data coverage →</span></div>

        <section className="brief" aria-labelledby="brief-title"><div className="section-head"><div><div className="brief-label"><span>✳</span> YOUR MONEY BRIEF</div><h2 id="brief-title">A few things to look at</h2></div><button className="period">Last 30 days <span>⌄</span></button></div>
          <div className="brief-grid">{observations.map((item) => <article className="insight" key={item.title}><div className={`insight-mark ${item.tone}`}>{item.mark}</div><div className="insight-copy"><h3>{item.title}</h3><p>{item.text}</p><b>{formatNgn(item.amount)}</b></div><span className="arrow">↗</span></article>)}</div>
          <p className="brief-foot">These observations use records entered or imported into Ledgerly. They don’t include unrecorded or live bank activity.</p>
        </section>

        <section className="metrics" aria-label="Business summaries"><article className="metric"><div><span>Recorded cash</span><span className="metric-icon green">↗</span></div><strong>{formatNgn(284530000)}</strong><small>Across your tracking labels</small><a href="#cashflow">See cash movement →</a></article><article className="metric"><div><span>Income</span><span className="metric-icon">＋</span></div><strong>{formatNgn(186450000)}</strong><small>Last 30 days</small><a href="#transactions">View income →</a></article><article className="metric"><div><span>Expenses</span><span className="metric-icon coral">↘</span></div><strong>{formatNgn(97820000)}</strong><small>Last 30 days</small><a href="#transactions">View expenses →</a></article><article className="metric"><div><span>To collect</span><span className="metric-icon amber">◷</span></div><strong>{formatNgn(32750000)}</strong><small>Across 6 open invoices</small><a href="#invoices">View invoices →</a></article></section>

        <section className="lower-grid"><article className="panel movement" id="cashflow"><div className="panel-head"><div><h2>Cash movement</h2><p>Recorded income and expenses over time</p></div><button className="period">6 months <span>⌄</span></button></div><div className="chart"><div className="axis"><span>₦500k</span><span>₦350k</span><span>₦200k</span><span>₦50k</span></div><div className="bars">{[[48,32],[65,43],[51,38],[78,45],[60,52],[86,48]].map(([a,b],i)=><div className="bar-group" key={i}><div className="bar-pair"><i style={{height:`${a}%`}}/><i style={{height:`${b}%`}}/></div><small>{["Jun","Jul","Aug","Sep","Oct","Nov"][i]}</small></div>)}</div></div><div className="legend"><span><i/> Income</span><span><i/> Expenses</span><small>Illustrative sample data</small></div></article>
          <article className="panel attention"><div className="panel-head"><div><h2>Needs your attention</h2><p>Follow up on what’s due</p></div><button className="more" aria-label="More options">•••</button></div><a href="#invoices" className="attention-row"><span className="attention-icon amber">↗</span><span><b>Invoice overdue</b><small>INV-024 · Adeola Foods · 8 days</small></span><strong>{formatNgn(14500000)}</strong></a><a href="#suppliers" className="attention-row"><span className="attention-icon blue">◷</span><span><b>Bill due Friday</b><small>BILL-018 · Midas Packaging</small></span><strong>{formatNgn(6200000)}</strong></a><a className="all-link" href="#invoices">See all reminders <span>→</span></a></article></section>

        <section className="panel transactions" id="transactions"><div className="panel-head"><div><h2>Recent transactions</h2><p>Your latest recorded activity</p></div><a className="all-link" href="#transactions">View all →</a></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th></tr></thead><tbody>{rows.map(([date,description,type,amount])=><tr key={description}><td>{date}</td><td className="description">{description}</td><td><span className={`tag ${type === "Income" ? "income" : "expense"}`}>{type}</span></td><td className={amount > 0 ? "positive" : "negative"}>{amount > 0 ? "+" : "−"}{formatNgn(Math.abs(amount))}</td></tr>)}</tbody></table></div></section>
        <footer>Ledgerly shows records provided by your business. Recorded cash is a calculation from those records, not a live bank balance.</footer>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation"><a className="selected" href="#overview">◫<small>Home</small></a><a href="#transactions">↕<small>Activity</small></a><a href="#invoices">▤<small>Invoices</small></a><a href="#settings">☰<small>More</small></a></nav>
    </section>
  </main>;
}
