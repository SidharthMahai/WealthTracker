"use client";
import { useCallback, useEffect, useState } from "react";
export type Assets = { cash: number; goldValue: number | null; rate: number | null; asOf: string | null; gold: { date: string; acquisition: string; grams: number; karat: number }[] };
export function useAssets() {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [assetError, setAssetError] = useState("");
  const refreshAssets = useCallback(async () => {
    try {
      const response = await fetch("/api/assets");
      if (!response.ok) throw new Error("Unable to load cash and gold.");
      setAssets(await response.json());
      setAssetError("");
    } catch (error) { setAssetError(error instanceof Error ? error.message : "Unable to load assets."); }
  }, []);
  useEffect(() => { void refreshAssets(); }, [refreshAssets]);
  async function editCash() {
    const value = window.prompt("Current cash in hand (INR)", String(assets?.cash ?? 0));
    if (value === null) return;
    const balance = Number(value);
    if (!value.trim() || !Number.isFinite(balance) || balance < 0) { setAssetError("Enter a valid non-negative balance."); return; }
    try {
      const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "cash", balance }) });
      if (!response.ok) throw new Error("Unable to save cash balance.");
      setAssets(await response.json()); setAssetError("");
    } catch (error) { setAssetError(error instanceof Error ? error.message : "Unable to save."); }
  }
  return { assets, assetError, refreshAssets, editCash };
}
