import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/common/Button";
import { cn } from "@/lib/cn";
import * as api from "@/ipc/commands";
import {
  errorMessage,
  type ConnectionProfile,
  type SslMode,
} from "@/ipc/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUiStore } from "@/stores/uiStore";

interface FormState {
  name: string;
  host: string;
  port: string;
  dbname: string;
  user: string;
  password: string;
  sslMode: SslMode;
  savePassword: boolean;
}

const BLANK: FormState = {
  name: "",
  host: "localhost",
  port: "5432",
  dbname: "postgres",
  user: "postgres",
  password: "",
  sslMode: "prefer",
  savePassword: false,
};

const SSL_MODES: SslMode[] = ["disable", "prefer", "require"];

/**
 * The connect form plus a list of saved connection profiles. Mounted once and
 * shows itself based on the UI store's `connectionDialogOpen` flag.
 */
export function ConnectionDialog() {
  const open = useUiStore((s) => s.connectionDialogOpen);
  const close = useUiStore((s) => s.closeConnectionDialog);

  const connect = useConnectionStore((s) => s.connect);
  const connectString = useConnectionStore((s) => s.connectString);
  const status = useConnectionStore((s) => s.status);
  const connectError = useConnectionStore((s) => s.error);
  const connecting = status === "opening";

  const [mode, setMode] = useState<"fields" | "url">("fields");
  const [connStr, setConnStr] = useState("");
  const [form, setForm] = useState<FormState>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const refreshProfiles = useCallback(() => {
    api.listConnections().then(setProfiles).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (open) refreshProfiles();
  }, [open, refreshProfiles]);

  if (!open) return null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function loadProfile(p: ConnectionProfile) {
    setEditingId(p.id);
    setLocalError(null);
    setForm({
      name: p.name,
      host: p.host,
      port: String(p.port),
      dbname: p.dbname,
      user: p.user,
      password: p.password ?? "",
      sslMode: p.sslMode,
      savePassword: p.savePassword,
    });
    if (p.connectionString != null) {
      setMode("url");
      setConnStr(p.connectionString);
    } else {
      setMode("fields");
    }
  }

  function newProfile() {
    setEditingId(null);
    setLocalError(null);
    setConnStr("");
    setForm(BLANK);
  }

  async function handleConnect() {
    setLocalError(null);
    const ok =
      mode === "url"
        ? await connectString(connStr.trim())
        : await connect({
            host: form.host.trim(),
            port: Number(form.port),
            dbname: form.dbname.trim(),
            user: form.user.trim(),
            password: form.password ? form.password : null,
            sslMode: form.sslMode,
          });
    if (ok) close();
  }

  async function handleSave() {
    setLocalError(null);
    try {
      const base = {
        id: editingId ?? "",
        name: form.name.trim(),
        savePassword: form.savePassword,
        createdAt: 0,
      };
      const profile: ConnectionProfile =
        mode === "url"
          ? {
              ...base,
              name: base.name || "Connection string",
              // The string embeds the password; drop it unless asked to keep it.
              connectionString: form.savePassword
                ? connStr.trim()
                : stripPassword(connStr.trim()),
              host: "",
              port: 5432,
              dbname: "",
              user: "",
              password: null,
              sslMode: "prefer",
            }
          : {
              ...base,
              name: base.name || `${form.user}@${form.host}/${form.dbname}`,
              host: form.host.trim(),
              port: Number(form.port),
              dbname: form.dbname.trim(),
              user: form.user.trim(),
              password: form.savePassword ? form.password : null,
              sslMode: form.sslMode,
              connectionString: null,
            };
      const saved = await api.saveConnection(profile);
      setEditingId(saved.id);
      refreshProfiles();
    } catch (e) {
      setLocalError(errorMessage(e));
    }
  }

  async function handleDelete(id: string) {
    await api.deleteConnection(id).catch(() => undefined);
    if (editingId === id) newProfile();
    refreshProfiles();
  }

  const error = localError ?? connectError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div
        className="flex h-[32rem] w-[52rem] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Saved profiles */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-2">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted">
            <span>Saved connections</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {profiles.length === 0 ? (
              <p className="px-2 py-3 text-2xs text-muted">No saved connections yet.</p>
            ) : (
              profiles.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "group flex items-center gap-1 rounded px-2 py-1.5 text-xs",
                    "cursor-pointer hover:bg-surface",
                    editingId === p.id && "bg-surface text-fg",
                  )}
                  onClick={() => loadProfile(p)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-fg">{p.name}</div>
                    <div className="truncate text-2xs text-muted">
                      {p.connectionString != null
                        ? "connection string"
                        : `${p.user}@${p.host}:${p.port}/${p.dbname}`}
                    </div>
                  </div>
                  <button
                    className="hidden rounded px-1 text-muted hover:text-red-400 group-hover:block"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(p.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-2">
            <Button variant="ghost" className="w-full justify-center" onClick={newProfile}>
              New connection
            </Button>
          </div>
        </aside>

        {/* Form */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Connect to PostgreSQL</h2>
            <button className="text-muted hover:text-fg" onClick={close} title="Close">
              ✕
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {/* Mode toggle: discrete fields vs. a raw connection string. */}
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(["fields", "url"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-3 py-1 transition",
                    mode === m ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {m === "fields" ? "Parameters" : "Connection string"}
                </button>
              ))}
            </div>

            {mode === "url" ? (
              <>
                <Field label="Name (optional)">
                  <Input
                    value={form.name}
                    placeholder="My database"
                    onChange={(v) => set("name", v)}
                  />
                </Field>
                <Field label="Connection string">
                  <textarea
                    value={connStr}
                    placeholder="postgres://user:password@host:5432/database?sslmode=require"
                    onChange={(e) => setConnStr(e.target.value)}
                    spellCheck={false}
                    rows={3}
                    className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg placeholder:text-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  />
                  <span className="mt-1 block text-2xs text-muted">
                    URI (<code>postgres://…</code>) or key=value (<code>host=… dbname=…</code>) form.
                  </span>
                </Field>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={form.savePassword}
                    onChange={(e) => set("savePassword", e.target.checked)}
                  />
                  Save password (stores the string as-is; otherwise the password is stripped)
                </label>
              </>
            ) : (
              <>
                <Field label="Name (optional)">
                  <Input
                    value={form.name}
                    placeholder="My database"
                    onChange={(v) => set("name", v)}
                  />
                </Field>

                <div className="flex gap-3">
                  <Field label="Host" className="flex-1">
                    <Input value={form.host} onChange={(v) => set("host", v)} />
                  </Field>
                  <Field label="Port" className="w-24">
                    <Input value={form.port} onChange={(v) => set("port", v)} />
                  </Field>
                </div>

                <Field label="Database">
                  <Input value={form.dbname} onChange={(v) => set("dbname", v)} />
                </Field>

                <div className="flex gap-3">
                  <Field label="User" className="flex-1">
                    <Input value={form.user} onChange={(v) => set("user", v)} />
                  </Field>
                  <Field label="Password" className="flex-1">
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(v) => set("password", v)}
                    />
                  </Field>
                </div>

                <div className="flex items-end gap-3">
                  <Field label="SSL mode" className="w-40">
                    <select
                      className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      value={form.sslMode}
                      onChange={(e) => set("sslMode", e.target.value as SslMode)}
                    >
                      {SSL_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 pb-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={form.savePassword}
                      onChange={(e) => set("savePassword", e.target.checked)}
                    />
                    Save password
                  </label>
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <Button variant="ghost" onClick={() => void handleSave()}>
              {editingId ? "Update" : "Save"}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Best-effort removal of the password from a connection string for storage. */
function stripPassword(s: string): string {
  return (
    s
      // URI form: scheme://user:pass@host -> scheme://user@host
      .replace(/(:\/\/[^:/?#@]+):[^@]*@/, "$1@")
      // key=value form: drop a password=... token (quoted or bare)
      .replace(/(^|\s)password=('[^']*'|"[^"]*"|\S+)/gi, "$1")
      .trim()
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    />
  );
}
