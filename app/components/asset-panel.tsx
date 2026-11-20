"use client";
import { useEffect, useState } from "react";
type Assets = { cash: number; goldValue: number | null; rate: number | null; asOf: string | null; gold: { date: string; acquisition: string; grams: number; karat: number }[] };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
export function AssetPanel({ bankValue, onValueChange }: { bankValue: number; onValueChange: (value: number | null) => void }) {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onValueChange(assets && assets.goldValue !== null ? assets.cash + assets.goldValue : null);
  }, [assets, onValueChange]);
  useEffect(() => {
    fetch("/api/assets").then(async response => { if (!response.ok) throw new Error("Unable to load assets."); setAssets(await response.json()); }).catch(error => setError(error.message));
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>, kind: "cash" | "gold") {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const payload = kind === "cash" ? { kind, balance: Number(fields.get("balance")) } : { kind, date: fields.get("date"), acquisition: fields.get("acquisition"), grams: Number(fields.get("grams")), karat: Number(fields.get("karat")) };
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setAssets(result);
      if (kind === "gold") form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="metrics-grid">
      <article className="metric-card"><p>Cash in bank</p><h2>{money(bankValue)}</h2></article>
      <article className="metric-card"><p>Cash in hand</p><h2>{assets ? money(assets.cash) : "—"}</h2></article>
      <article className="metric-card"><p>Gold (current value)</p><h2>{assets?.goldValue != null ? money(assets.goldValue) : "Unavailable"}</h2><p>Spot estimate · excludes taxes and making charges</p>{assets?.asOf && <small>Quote: {assets.asOf}</small>}</article>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="content-grid">
      <form onSubmit={event => save(event, "cash")} className="panel form-panel">
        <h2>Cash in hand</h2><label>Balance (INR)<input key={assets?.cash} name="balance" type="number" min="0" step="0.01" defaultValue={assets?.cash} required /></label>
        <button disabled={busy || !assets} type="submit">Save balance</button>
      </form>
      <form onSubmit={event => save(event, "gold")} className="panel form-panel">
        <h2>Add gold asset</h2><div className="form-grid">
          <label>Date<input name="date" type="date" required /></label>
          <label>Acquired through<select name="acquisition"><option>Purchase</option><option>Gift</option></select></label>
          <label>Purity (KT)<input name="karat" type="number" min="1" max="24" step="1" defaultValue="22" required /></label>
          <label>Weight (grams)<input name="grams" type="number" min="0.001" step="0.001" required /></label>
        </div><p>Value is calculated automatically using weight, purity and the current gold rate.</p><button disabled={busy || !assets} type="submit">{busy ? "Saving…" : "Add gold"}</button>
      </form>
    </div>
    {!!assets?.gold.length && <div className="table-scroll"><table><thead><tr><th>Date</th><th>Acquisition</th><th>KT</th><th>Grams</th><th>Current estimate</th></tr></thead><tbody>{assets.gold.map((item, index) => <tr key={index}><td>{item.date}</td><td>{item.acquisition}</td><td>{item.karat}</td><td>{item.grams}</td><td>{assets.rate == null ? "Unavailable" : money(item.grams * item.karat / 24 * assets.rate)}</td></tr>)}</tbody></table></div>}
  </section>;
}
