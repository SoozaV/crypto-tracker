import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Wallet, ImportReport, ExportBundle } from '../types';
import { renameWallet, exportData, importData, resetAll } from '../services/api';
import { Card, SectionLabel, Spinner } from './ui';

interface Props {
  wallets: Wallet[];
  onChanged: () => void;
}

const field =
  'rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40';

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---- Renombrar wallets ---- */
function WalletsSection({ wallets, onChanged }: Props) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (w: Wallet) => {
    const newName = (names[w.id] ?? w.name).trim();
    if (!newName || newName === w.name) return;
    setSavingId(w.id);
    setMsg(null);
    try {
      await renameWallet(w.id, { name: newName });
      onChanged();
      setMsg(`Wallet renombrada a “${newName}”.`);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      setMsg(ax.response?.data?.detail ?? 'No se pudo renombrar.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="p-5">
      <SectionLabel>Wallets</SectionLabel>
      {wallets.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No hay wallets todavía.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {wallets.map((w) => (
            <li key={w.id} className="flex items-center gap-2">
              <input
                defaultValue={w.name}
                onChange={(e) => setNames({ ...names, [w.id]: e.target.value })}
                className={`${field} flex-1`}
              />
              <span className="num w-24 text-xs text-muted">{w.type}</span>
              <button
                onClick={() => save(w)}
                disabled={savingId === w.id}
                className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-50"
              >
                {savingId === w.id ? <Spinner /> : 'Guardar'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
    </Card>
  );
}

/* ---- Exportar / Importar ---- */
function BackupSection({ wallets, onChanged }: Props) {
  const [scope, setScope] = useState<'all' | number>('all');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doExport = async () => {
    setErr(null);
    try {
      const walletId = scope === 'all' ? undefined : scope;
      const data = await exportData(walletId);
      const tag = scope === 'all' ? 'global' : `wallet-${walletId}`;
      const stamp = new Date().toISOString().slice(0, 10);
      download(`crypto-tracker-${tag}-${stamp}.json`, data);
    } catch {
      setErr('No se pudo exportar.');
    }
  };

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reimportar el mismo archivo
    if (!file) return;
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as ExportBundle;
      const r = await importData(payload);
      setReport(r);
      onChanged();
    } catch (er: unknown) {
      const ax = er as { response?: { data?: { detail?: string } }; message?: string };
      setErr(ax.response?.data?.detail ?? ax.message ?? 'Archivo inválido.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <SectionLabel>Copia de seguridad</SectionLabel>
      <p className="mt-1 text-sm text-muted">
        Exporta a un archivo JSON e impórtalo cuando quieras. La importación
        <span className="text-ink"> no duplica</span>: cada transacción tiene un id
        estable, así que reimportar el mismo archivo es seguro.
      </p>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs text-muted">Ámbito de exportación</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className={`${field} block`}
            >
              <option value="all">Todo (global)</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>Solo {w.name}</option>
              ))}
            </select>
          </label>
          <button onClick={doExport} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Exportar JSON
          </button>
        </div>

        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-surface2">
            {busy ? <Spinner /> : '⭑'} Importar archivo…
            <input type="file" accept="application/json,.json" onChange={doImport} className="hidden" />
          </label>
        </div>

        {report && (
          <p className="num rounded-lg bg-gain/10 px-3 py-2 text-sm text-gain">
            Importadas {report.transactions_imported} · omitidas (duplicadas)
            {' '}{report.transactions_skipped} · wallets nuevas {report.wallets_created} ·
            {' '}activos nuevos {report.assets_created}
          </p>
        )}
        {err && <p className="text-sm text-loss">{err}</p>}
      </div>
    </Card>
  );
}

/* ---- Zona de peligro (reset) ---- */
function DangerSection({ onChanged }: { onChanged: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const doReset = async () => {
    if (confirmText !== 'RESET') return;
    setBusy(true);
    try {
      const r = await resetAll();
      const total = Object.values(r.deleted).reduce((a, b) => a + b, 0);
      setDone(`Datos borrados (${total} registros). Puedes empezar de cero.`);
      setConfirmText('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-loss/40 p-5">
      <SectionLabel>Zona de peligro</SectionLabel>
      <p className="mt-1 text-sm text-muted">
        Borra <span className="text-ink">todas</span> las wallets, activos,
        transacciones e histórico de precios. Esta acción es irreversible; exporta
        antes si quieres conservar una copia.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Escribe RESET para confirmar"
          className={`${field} w-56`}
        />
        <button
          onClick={doReset}
          disabled={confirmText !== 'RESET' || busy}
          className="rounded-lg bg-loss px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Borrando…' : 'Resetear todo'}
        </button>
      </div>
      {done && <p className="mt-3 text-sm text-gain">{done}</p>}
    </Card>
  );
}

const Settings: React.FC<Props> = ({ wallets, onChanged }) => (
  <div className="mx-auto max-w-2xl space-y-5">
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      ← Volver al portafolio
    </Link>
    <h2 className="text-xl font-semibold text-ink">Ajustes</h2>
    <WalletsSection wallets={wallets} onChanged={onChanged} />
    <BackupSection wallets={wallets} onChanged={onChanged} />
    <DangerSection onChanged={onChanged} />
  </div>
);

export default Settings;
